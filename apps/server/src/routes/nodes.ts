import crypto from "node:crypto";
import { Hono } from "hono";
import {
  AspectRatioSchema,
  groupIdOf,
  ModelOverridesSchema,
  NodesCreateRequestSchema,
  NodesUploadRequestSchema,
  type ModelOverrides,
  type Node,
  type NodeTapsResponse,
  type NodesVersionsResponse,
  type VersionSummary,
} from "@orbis/shared";
import {
  addImageVariant,
  countGroupVersions,
  decodeGalleryCursor,
  findChildrenBySubject,
  getHistory,
  getMorphInfo,
  getNode,
  getVideoInfo,
  insertNode,
  listGalleryPage,
  listVersions,
  resolveGroupDefault,
  setDefaultVersion,
} from "../storage/nodes.js";
import { listTapCache } from "../storage/tapCache.js";
import { saveImageVariantResized } from "../pipeline/imageStorage.js";
import { getMorphReverseUrl } from "../pipeline/morphStorage.js";
import { normalizeSubject } from "../pipeline/normalize.js";
import { buildImagePrompt } from "../pipeline/artStyle.js";
import { getTapDedupMode, isUploadEnabled } from "../pipeline/config.js";
import { InFlight } from "../lib/coalesce.js";
import { parseDataUrl } from "../lib/dataUrl.js";
import { toProviderOverrides, type ProviderResolver } from "../providers/index.js";
import { withModelFallback } from "../providers/image/modelFallback.js";
import type { VideoPipeline } from "../pipeline/video.js";
import type { MorphPipeline } from "../pipeline/morph.js";

const DEFAULT_GALLERY_LIMIT = 8;
const MAX_GALLERY_LIMIT = 24;

/**
 * The two on-demand clip endpoints accept an OPTIONAL JSON body carrying the same override keys as
 * a generate request, so "Animate page" honours the UI's settings panel. Both were bodyless before
 * and must stay callable that way: a missing, empty, or unparseable body resolves to no overrides,
 * i.e. the server's configured defaults, exactly as it behaved previously.
 *
 * The read endpoints below take no overrides. The variant endpoint takes none either, but for the
 * opposite reason: it needs the provider/model that drew the *original* page, which it reads from
 * the node's own provenance columns rather than from the caller.
 */
async function readOverrides(c: { req: { json: () => Promise<unknown> } }): Promise<ModelOverrides> {
  const body = await c.req.json().catch(() => null);
  // Whole-bag safeParse is safe here only because every field of ModelOverridesSchema carries
  // `.catch(undefined)`: a malformed value costs that one field, not the caller's entire selection.
  // Without that, one bad number silently reverted provider, model and resolution to server
  // defaults with nothing said. A non-object body still lands on `{}`, which means "server default".
  const parsed = ModelOverridesSchema.safeParse(body ?? {});
  return parsed.success ? parsed.data : {};
}

/** The clip-only slice of an override bag, for the background-clip pipelines. */
function toClipOptions(o: ModelOverrides): { resolution?: string; durationSeconds?: number } {
  return { resolution: o.video_resolution, durationSeconds: o.video_duration_seconds };
}

/** The branch control's list view of one version — a thin projection of a Node. The thumbnail is the
 *  first available aspect-ratio variant, since a version may not have the ratio the client shows. */
function toVersionSummary(node: Node): VersionSummary {
  return {
    id: node.id,
    page_title: node.page_title,
    image_url: node.image_variants["16:9"] ?? node.image_variants["3:4"] ?? node.image_variants["1:1"] ?? null,
    edit_command: node.edit_command ?? null,
    edited_from_id: node.edited_from_id ?? null,
    is_default: node.is_default ?? false,
    created_at: node.created_at,
  };
}

/** The branch control's response for a node: every version of its group, oldest first, projected.
 *  Shared by the /versions and /default routes, which build the exact same payload. */
function versionsPayload(node: Node): NodesVersionsResponse {
  return { versions: listVersions(groupIdOf(node)).map(toVersionSummary) };
}

export function nodesRoute(
  resolveProviders: ProviderResolver,
  imagesDir: string,
  video: VideoPipeline,
  morph: MorphPipeline,
): Hono {
  const app = new Hono();

  // Stampede guard for lazy variant generation: two concurrent requests for the same
  // missing (node, ratio) both pass the `image_variants[ratio]` check and would each pay for a
  // full image generation. Coalescing lets the second ride the first's result. Lives in the
  // factory closure so it persists for the process, one map shared across all requests.
  const variantInFlight = new InFlight<Node | null>();

  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = NodesCreateRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid request", issues: parsed.error.issues }, 400);
    }
    const input = parsed.data;

    const id = input.id ?? crypto.randomUUID().replace(/-/g, "");
    const existing = getNode(id);
    if (existing) return c.json({ node: existing }, 200);

    // A parent must already exist. Refusing a dangling parent makes a parent_id cycle impossible
    // to store (a child can only point at an older node, never at itself or a descendant), which
    // is what keeps getHistory's ancestor walk from ever looping. Without this, a client could
    // POST {id:"x", parent_id:"x"} and then hang the server by fetching that node.
    if (input.parent_id !== null && !getNode(input.parent_id)) {
      return c.json({ error: "parent_id does not reference an existing node" }, 400);
    }

    const node: Node = {
      ...input,
      id,
      created_at: new Date().toISOString(),
      version: 1,
    };
    // No providerId available on this generic persistence request, so this node is never
    // offered for prompt-hash reuse — only the generate pipeline populates it.
    insertNode(node, { normalizedSubject: normalizeSubject(node.query), promptHash: null });
    return c.json({ node }, 201);
  });

  // Landing-page example gallery — a page of already-generated nodes, zero new generations.
  // `?limit=all` returns every gallery-eligible page with no cap; any other value is clamped to
  // MAX_GALLERY_LIMIT. The uncapped form exists because the cap is a presentation choice, not a
  // safety one, and a self-hosted instance may legitimately want the whole set — but it does read
  // every matching row, so prefer a number for a public deployment whose database can grow without
  // bound.
  //
  // `?cursor=` continues below a previous batch. The response carries the cursor for the batch
  // after it in `next_cursor`, which is null once the last batch is served. There is no `page`
  // number and no total: the table gains a root on every generation, so a row's distance from the
  // top changes under the reader, while its position relative to a cursor does not.
  app.get("/", (c) => {
    const raw = c.req.query("limit");
    const limitParam = Number(raw);
    const limit =
      raw === "all"
        ? null
        : Number.isFinite(limitParam) && limitParam > 0
          ? // Floor it, because a fractional limit would reach SQLite's LIMIT clause as a float.
            // Then raise it to 1. A value such as 0.5 passes the "greater than zero" test above and
            // floors to 0, which returns an empty gallery with status 200. The client cannot tell
            // that from a database with no pages in it.
            Math.max(1, Math.floor(Math.min(limitParam, MAX_GALLERY_LIMIT)))
          : DEFAULT_GALLERY_LIMIT;

    // Reject a malformed cursor instead of falling back to the first batch. A silent fallback makes
    // the client append the same cards it already shows, and it never reaches the end.
    const rawCursor = c.req.query("cursor");
    const cursor = rawCursor === undefined ? null : decodeGalleryCursor(rawCursor);
    if (rawCursor !== undefined && cursor === null) {
      return c.json({ error: "Invalid cursor" }, 400);
    }

    const { nodes, nextCursor } = listGalleryPage({ limit, cursor });
    // Per-card version count for the branch badge. One COUNT per card — fine at limit <= 24, backed
    // by nodes_version_group_idx (see PLAN-versions.md, finding 12).
    const version_counts: Record<string, number> = {};
    for (const n of nodes) version_counts[n.id] = countGroupVersions(groupIdOf(n));
    return c.json({ nodes, next_cursor: nextCursor, version_counts });
  });

  // User-uploaded photo becomes a root node (parent_id null), titled by the VLM.
  // Gated behind UPLOAD_ENABLED (default off) — enforced here as well as by hiding the button, so a
  // stale client or a direct API call can't upload when the feature is turned off.
  app.post("/upload", async (c) => {
    if (!isUploadEnabled()) return c.json({ error: "Photo upload is disabled" }, 403);
    const body = await c.req.json().catch(() => null);
    const parsed = NodesUploadRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid request", issues: parsed.error.issues }, 400);
    }
    const { image, aspect_ratio, session_id } = parsed.data;

    let contentType: string, data: string;
    try {
      ({ mimeType: contentType, base64: data } = parseDataUrl(image));
    } catch {
      return c.json({ error: "Invalid image data URL" }, 400);
    }
    const bytes = Buffer.from(data, "base64");

    const providers = resolveProviders();
    const id = crypto.randomUUID().replace(/-/g, "");
    // The VLM title and the image resize+write are independent — the write needs only the id and the
    // decoded bytes, not the title — so overlap them rather than paying the resize latency serially
    // after the multi-second VLM call.
    const [{ title, description }, imageUrl] = await Promise.all([
      providers.llm.titleImage(image),
      saveImageVariantResized(imagesDir, id, aspect_ratio, bytes, contentType),
    ]);

    const node: Node = {
      id,
      parent_id: null,
      session_id,
      query: title,
      page_title: title,
      image_variants: { [aspect_ratio]: imageUrl },
      image_model: "upload",
      // No provenance: an uploaded photo was not drawn by any model, so there is nothing to
      // reproduce. Left empty rather than set to a sentinel, because the variant route keys off
      // `image_provider` being non-empty — a sentinel would be fed back as a real provider name.
      // (`image_model: "upload"` above is pre-existing and stays for display purposes only.)
      image_provider: "",
      art_style: "",
      composition: "",
      prompt_author_model: providers.llm.modelId,
      authored_prompt: description,
      // An uploaded photo has no authored labels or footer — it renders image-only, like an old node.
      labels: [],
      footer: "",
      labels_aspect: null,
      created_at: new Date().toISOString(),
      version: 1,
      // An uploaded image is not a generated page, so no idle-loop clip or morph is ever made for it.
      video_status: null,
      morph_status: null,
    };
    insertNode(node, { normalizedSubject: normalizeSubject(title), promptHash: null });
    return c.json({ node }, 201);
  });

  // Already-explored tap points. Returns only spots that resolve all the way to at least one
  // existing child page: a tap-cache row on its own says nothing the user can act on.
  //
  // `mode` travels with the list because the same coordinates mean different things to the client.
  // Under "reuse" a marker is a free shortcut to the one child. Under "variant" it is a disclosure —
  // the spot is known, but drawing again costs money, so the client opens a panel instead of
  // navigating. Under "off" the list is always empty: nothing is cached, and rows left behind by an
  // earlier run in another mode must not resurface as markers for a mode that ignores them.
  app.get("/:id/taps", (c) => {
    const id = c.req.param("id");
    const ratio = AspectRatioSchema.safeParse(c.req.query("ratio"));
    if (!ratio.success) return c.json({ error: "Invalid or missing ratio" }, 400);

    const mode = getTapDedupMode();
    if (mode === "off") return c.json({ mode, taps: [] } satisfies NodeTapsResponse);

    const taps = listTapCache(id, ratio.data).flatMap((row) => {
      const children = findChildrenBySubject(id, normalizeSubject(row.subject));
      if (children.length === 0) return [];
      return [
        {
          x: row.x,
          y: row.y,
          subject: row.subject,
          children: children.map((child) => {
            // `children` are the PRIMARY child of each variant (edit versions are excluded). Open the
            // group's current default instead, so a marker matches what a repeat tap and the branch
            // control resolve to.
            const target = resolveGroupDefault(child);
            return {
              id: target.id,
              page_title: target.page_title,
              // Null rather than omitted: a child first drawn at another aspect ratio has no image
              // for this one until the variant route lazily makes it, and the panel must render that
              // row as a placeholder instead of dropping a real page from the list.
              image_url: target.image_variants[ratio.data] ?? null,
              created_at: target.created_at,
            };
          }),
        },
      ];
    });
    return c.json({ mode, taps } satisfies NodeTapsResponse);
  });

  // Idle-loop video polling: 404 until the background clip is ready, whether
  // it's still pending, failed, or was never attempted — the client just keeps polling with
  // backoff and gives up on its own after a while, so no separate "failed" signal is needed here.
  app.get("/:id/video", (c) => {
    const id = c.req.param("id");
    const info = getVideoInfo(id);
    if (!info || info.status !== "ready" || !info.url) {
      // `status` mirrors /:id/morph below: the backoff poller ignores it, but the pre-navigation clip
      // gate (useOrbisController) uses it to tell "still rendering, keep waiting" from "failed,
      // stop waiting and go" while it holds the transition for this clip.
      return c.json({ ready: false, status: info?.status ?? null }, 404);
    }
    return c.json({ ready: true, video_url: info.url });
  });

  // On-demand idle-loop generation: the two automatic paths (new node, morph)
  // only make a clip at creation time and only while Live video is on, so any page created with it
  // off never gets one. This lets a user, viewing such a page, ask for the clip now. It still spends
  // real video quota, so it stays gated by VIDEO_ENABLED and the per-session cap; a `failed` node is
  // retryable here (deliberate action), a `pending`/`ready` one is not re-run. After "started"/
  // "already-pending" the client polls GET /:id/video exactly as it does for the automatic path.
  app.post("/:id/video", async (c) => {
    const id = c.req.param("id");
    const node = getNode(id);
    if (!node) return c.json({ error: "Not found" }, 404);

    const overrides = await readOverrides(c);
    const result = video.startIdleLoopNow(
      node,
      resolveProviders(toProviderOverrides(overrides)),
      imagesDir,
      toClipOptions(overrides),
    );
    switch (result) {
      case "started":
      case "already-pending":
        return c.json({ status: "pending" }, 202);
      case "already-ready": {
        const info = getVideoInfo(id);
        return c.json({ status: "ready", video_url: info?.url }, 200);
      }
      case "disabled":
        return c.json({ error: "Video generation is disabled on this server" }, 403);
      case "session-cap":
        return c.json({ error: "Video generation limit reached for this session" }, 429);
      case "unavailable":
        return c.json({ error: "This page has no image to animate" }, 422);
    }
  });

  // Transition-morph polling: 404 until the pre-generated clip is ready — same
  // shape and reasoning as /video above. Morphs are never generated on demand, so a 404 here just
  // means "use the instant crossfade", not "come back later and block on it". The `status` field on
  // the not-ready branch lets the first-step-morph gate (useOrbisController) tell "still pending,
  // keep waiting" from "failed, give up and navigate now" while it holds navigation for this clip.
  app.get("/:id/morph", (c) => {
    const id = c.req.param("id");
    const info = getMorphInfo(id);
    if (!info || info.status !== "ready" || !info.url) {
      return c.json({ ready: false, status: info?.status ?? null }, 404);
    }
    // `reverse_url` is present only once the reversed re-encode has landed on disk. Stepping back
    // one level plays it so the same transition runs parent-ward; without it the client crossfades.
    return c.json({ ready: true, morph_url: info.url, reverse_url: getMorphReverseUrl(imagesDir, id) });
  });

  // On-demand morph generation — the counterpart to POST /:id/video above, and for the same reason:
  // the automatic path only fires the instant a child is created, and only while Live video is on,
  // so a child made with it off (or reopened from a cached tap marker, which never runs the generate
  // pipeline) had no way to ever get one. Same guards as the automatic path — MORPH_ENABLED and the
  // per-session cap still apply — with a `failed` node retryable here because this is a deliberate
  // action. A root page answers 422: there is no parent to morph from.
  app.post("/:id/morph", async (c) => {
    const id = c.req.param("id");
    const node = getNode(id);
    if (!node) return c.json({ error: "Not found" }, 404);

    const overrides = await readOverrides(c);
    const result = morph.startMorphNow(
      node,
      resolveProviders(toProviderOverrides(overrides)),
      imagesDir,
      toClipOptions(overrides),
    );
    switch (result) {
      case "started":
      case "already-pending":
        return c.json({ status: "pending" }, 202);
      case "already-ready": {
        const info = getMorphInfo(id);
        return c.json({ status: "ready", morph_url: info?.url }, 200);
      }
      case "disabled":
        return c.json({ error: "Morph generation is disabled on this server" }, 403);
      case "session-cap":
        return c.json({ error: "Morph generation limit reached for this session" }, 429);
      case "unavailable":
        return c.json({ error: "This page has no parent page to morph from" }, 422);
    }
  });

  // Every version of a page, oldest first, for the branch control. Resolves the group from any member
  // id, so the client can ask with whichever version it currently shows.
  app.get("/:id/versions", (c) => {
    const id = c.req.param("id");
    const node = getNode(id);
    if (!node) return c.json({ error: "Not found" }, 404);
    return c.json(versionsPayload(node));
  });

  // Makes this version the group's default — the one the gallery card opens (the star action). The
  // storage layer clears the old default in the same transaction. Returns the fresh list, so the
  // client updates its star state without a second request.
  app.post("/:id/default", (c) => {
    const id = c.req.param("id");
    const updated = setDefaultVersion(id);
    if (!updated) return c.json({ error: "Not found" }, 404);
    return c.json(versionsPayload(updated));
  });

  app.get("/:id", (c) => {
    const id = c.req.param("id");
    const node = getNode(id);
    if (!node) return c.json({ error: "Not found" }, 404);
    const history = getHistory(id);
    return c.json({ node, history });
  });

  // Lazily generates and caches a missing aspect-ratio variant of an existing node.
  app.get("/:id/variant", async (c) => {
    const id = c.req.param("id");
    const ratioParsed = AspectRatioSchema.safeParse(c.req.query("ratio"));
    if (!ratioParsed.success) return c.json({ error: "Invalid or missing ratio query param" }, 400);
    const ratio = ratioParsed.data;

    const node = getNode(id);
    if (!node) return c.json({ error: "Not found" }, 404);
    if (node.image_variants[ratio]) return c.json({ node });

    const updated = await variantInFlight.run(`${id}:${ratio}`, async () => {
      // Drawn from the page's OWN record, not the server's current settings.
      //
      // Two bugs lived here. `authored_prompt` is the content-only prompt, so sending it raw meant
      // a variant was drawn with no art-style, composition or framing block at all — a visibly
      // different picture from the page it belongs to. And the provider/model came from whatever
      // the server was set to at the time the variant was first requested, which is now something
      // the user can change mid-session.
      //
      // Nodes written before provenance was stored have empty fields; those fall back to the
      // server's current settings, which is the old behaviour and the best guess available.
      // Provider and model travel together: a model id means nothing without the provider it
      // belongs to. Keying both off `image_provider` also keeps an uploaded node's placeholder
      // `image_model: "upload"` from ever being sent to a provider as a real model id.
      const provenance = node.image_provider
        ? { imageProvider: node.image_provider, imageModel: node.image_model || undefined }
        : {};

      // A stored model id is a claim about the past, and the past expires: providers retire model
      // names, and the id recorded when the page was drawn may no longer exist by the time someone
      // rotates the page to another ratio. Unwrapped, that raised UnknownModelError out of a plain
      // GET and turned a working page into a 500 — worse than the behaviour this provenance replaced.
      //
      // Same rule as routes/generate.ts: wrap only when a model was actually named, because with no
      // model there is nothing to fall back FROM. `withModelFallback`'s own identity check then
      // skips the retry when the stored model IS the configured one, so no request is paid twice.
      // The notice can only be logged here — this is a JSON GET, with no stream to write to.
      const resolvedImage = resolveProviders(provenance).image;
      const image = provenance.imageModel
        ? withModelFallback(resolvedImage, () => resolveProviders({}).image, (n) =>
            console.warn(`[variant] node ${id}: model "${n.requested}" was rejected — drew with "${n.used}" (${n.reason})`),
          )
        : resolvedImage;

      const { bytes, contentType } = await image.generate({
        prompt: buildImagePrompt(node.authored_prompt, node.art_style || undefined, {
          composition: node.composition || undefined,
        }),
        aspectRatio: ratio,
      });
      const imageUrl = await saveImageVariantResized(imagesDir, id, ratio, bytes, contentType);
      return addImageVariant(id, ratio, imageUrl);
    });
    return c.json({ node: updated });
  });

  return app;
}
