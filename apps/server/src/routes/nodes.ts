import crypto from "node:crypto";
import { Hono } from "hono";
import { AspectRatioSchema, NodesCreateRequestSchema, NodesUploadRequestSchema, type Node } from "@flipbook/shared";
import {
  addImageVariant,
  findChildBySubject,
  getHistory,
  getMorphInfo,
  getNode,
  getVideoInfo,
  insertNode,
  listGalleryNodes,
} from "../storage/nodes.js";
import { listTapCache } from "../storage/tapCache.js";
import { saveImageVariantResized } from "../pipeline/imageStorage.js";
import { getMorphReverseUrl } from "../pipeline/morphStorage.js";
import { normalizeSubject } from "../pipeline/normalize.js";
import { getTapDedupMode, isUploadEnabled } from "../pipeline/config.js";
import { InFlight } from "../lib/coalesce.js";
import { parseDataUrl } from "../lib/dataUrl.js";
import type { Providers } from "../providers/index.js";
import type { VideoPipeline } from "../pipeline/video.js";
import type { MorphPipeline } from "../pipeline/morph.js";

const DEFAULT_GALLERY_LIMIT = 8;
const MAX_GALLERY_LIMIT = 24;

export function nodesRoute(providers: Providers, imagesDir: string, video: VideoPipeline, morph: MorphPipeline): Hono {
  const app = new Hono();

  // PLAN §2.3 stampede guard for lazy variant generation: two concurrent requests for the same
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
    // offered for prompt-hash reuse (PLAN §2.3 layer 3) — only the generate pipeline populates it.
    insertNode(node, { normalizedSubject: normalizeSubject(node.query), promptHash: null });
    return c.json({ node }, 201);
  });

  // Landing-page example gallery (PLAN §3 Phase 3) — a random sample of already-generated
  // nodes, zero new generations. `?limit=all` returns every gallery-eligible page with no cap;
  // any other value is clamped to MAX_GALLERY_LIMIT. The uncapped form exists because the cap is
  // a presentation choice, not a safety one, and a self-hosted instance may legitimately want the
  // whole set — but it does read every matching row, so prefer a number for a public deployment
  // whose database can grow without bound.
  app.get("/", (c) => {
    const raw = c.req.query("limit");
    const limitParam = Number(raw);
    const limit =
      raw === "all"
        ? null
        : Number.isFinite(limitParam) && limitParam > 0
          ? Math.min(limitParam, MAX_GALLERY_LIMIT)
          : DEFAULT_GALLERY_LIMIT;
    const nodes = listGalleryNodes(limit);
    return c.json({ nodes });
  });

  // User-uploaded photo becomes a root node (parent_id null), titled by the VLM (PLAN §3 Phase 2).
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

    const { title, description } = await providers.llm.titleImage(image);

    const id = crypto.randomUUID().replace(/-/g, "");
    const imageUrl = await saveImageVariantResized(imagesDir, id, aspect_ratio, bytes, contentType);

    const node: Node = {
      id,
      parent_id: null,
      session_id,
      query: title,
      page_title: title,
      image_variants: { [aspect_ratio]: imageUrl },
      image_model: "upload",
      prompt_author_model: providers.llm.modelId,
      authored_prompt: description,
      created_at: new Date().toISOString(),
      version: 1,
      // An uploaded image is not a generated page, so no idle-loop clip or morph is ever made for it.
      video_status: null,
      morph_status: null,
    };
    insertNode(node, { normalizedSubject: normalizeSubject(title), promptHash: null });
    return c.json({ node }, 201);
  });

  // Already-explored tap points (PLAN §2.3). Returns only spots that resolve all the way to an
  // existing child page, because those are the ones where a tap costs nothing — a tap-cache row on
  // its own merely skips the VLM call and still generates an image, which is not what the marker
  // promises. For the same reason the list is empty unless TAP_DEDUP is "reuse": in "variant" or
  // "off" mode a repeat tap deliberately generates a fresh page, so nothing here would be instant.
  app.get("/:id/taps", (c) => {
    const id = c.req.param("id");
    const ratio = AspectRatioSchema.safeParse(c.req.query("ratio"));
    if (!ratio.success) return c.json({ error: "Invalid or missing ratio" }, 400);
    if (getTapDedupMode() !== "reuse") return c.json({ taps: [] });

    const taps = listTapCache(id, ratio.data).flatMap((row) => {
      const child = findChildBySubject(id, normalizeSubject(row.subject));
      return child ? [{ x: row.x, y: row.y, subject: row.subject, child_id: child.id }] : [];
    });
    return c.json({ taps });
  });

  // Idle-loop video polling (PLAN §3 Phase 5): 404 until the background clip is ready, whether
  // it's still pending, failed, or was never attempted — the client just keeps polling with
  // backoff and gives up on its own after a while, so no separate "failed" signal is needed here.
  app.get("/:id/video", (c) => {
    const id = c.req.param("id");
    const info = getVideoInfo(id);
    if (!info || info.status !== "ready" || !info.url) {
      // `status` mirrors /:id/morph below: the backoff poller ignores it, but the pre-navigation clip
      // gate (useFlipbookController) uses it to tell "still rendering, keep waiting" from "failed,
      // stop waiting and go" while it holds the transition for this clip.
      return c.json({ ready: false, status: info?.status ?? null }, 404);
    }
    return c.json({ ready: true, video_url: info.url });
  });

  // On-demand idle-loop generation (PLAN §3 Phase 5): the two automatic paths (new node, morph)
  // only make a clip at creation time and only while Live video is on, so any page created with it
  // off never gets one. This lets a user, viewing such a page, ask for the clip now. It still spends
  // real video quota, so it stays gated by VIDEO_ENABLED and the per-session cap; a `failed` node is
  // retryable here (deliberate action), a `pending`/`ready` one is not re-run. After "started"/
  // "already-pending" the client polls GET /:id/video exactly as it does for the automatic path.
  app.post("/:id/video", (c) => {
    const id = c.req.param("id");
    const node = getNode(id);
    if (!node) return c.json({ error: "Not found" }, 404);

    const result = video.startIdleLoopNow(node, providers, imagesDir);
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

  // Transition-morph polling (PLAN §3 Phase 5): 404 until the pre-generated clip is ready — same
  // shape and reasoning as /video above. Morphs are never generated on demand, so a 404 here just
  // means "use the instant crossfade", not "come back later and block on it". The `status` field on
  // the not-ready branch lets the first-step-morph gate (useFlipbookController) tell "still pending,
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
  app.post("/:id/morph", (c) => {
    const id = c.req.param("id");
    const node = getNode(id);
    if (!node) return c.json({ error: "Not found" }, 404);

    const result = morph.startMorphNow(node, providers, imagesDir);
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

  app.get("/:id", (c) => {
    const id = c.req.param("id");
    const node = getNode(id);
    if (!node) return c.json({ error: "Not found" }, 404);
    const history = getHistory(id);
    return c.json({ node, history });
  });

  // Lazily generates and caches a missing aspect-ratio variant of an existing node (PLAN §3 Phase 2).
  app.get("/:id/variant", async (c) => {
    const id = c.req.param("id");
    const ratioParsed = AspectRatioSchema.safeParse(c.req.query("ratio"));
    if (!ratioParsed.success) return c.json({ error: "Invalid or missing ratio query param" }, 400);
    const ratio = ratioParsed.data;

    const node = getNode(id);
    if (!node) return c.json({ error: "Not found" }, 404);
    if (node.image_variants[ratio]) return c.json({ node });

    const updated = await variantInFlight.run(`${id}:${ratio}`, async () => {
      const { bytes, contentType } = await providers.image.generate({
        prompt: node.authored_prompt,
        aspectRatio: ratio,
      });
      const imageUrl = await saveImageVariantResized(imagesDir, id, ratio, bytes, contentType);
      return addImageVariant(id, ratio, imageUrl);
    });
    return c.json({ node: updated });
  });

  return app;
}
