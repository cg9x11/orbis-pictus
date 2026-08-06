import crypto from "node:crypto";
import { Hono } from "hono";
import { AspectRatioSchema, NodesCreateRequestSchema, NodesUploadRequestSchema, type Node } from "@flipbook/shared";
import {
  findChildBySubject,
  getHistory,
  getMorphInfo,
  getNode,
  getVideoInfo,
  insertNode,
  listGalleryNodes,
  updateImageVariants,
} from "../storage/nodes.js";
import { listTapCache } from "../storage/tapCache.js";
import { saveImageVariant } from "../pipeline/imageStorage.js";
import { normalizeSubject } from "../pipeline/normalize.js";
import { getTapDedupMode } from "../pipeline/config.js";
import type { Providers } from "../providers/index.js";

const DEFAULT_GALLERY_LIMIT = 8;
const MAX_GALLERY_LIMIT = 24;

export function nodesRoute(providers: Providers, imagesDir: string): Hono {
  const app = new Hono();

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
  app.post("/upload", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = NodesUploadRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid request", issues: parsed.error.issues }, 400);
    }
    const { image, aspect_ratio, session_id } = parsed.data;

    const match = /^data:(image\/\w+);base64,(.*)$/.exec(image);
    if (!match) return c.json({ error: "Invalid image data URL" }, 400);
    const [, contentType, data] = match;
    const bytes = Buffer.from(data!, "base64");

    const { title, description } = await providers.llm.titleImage(image);

    const id = crypto.randomUUID().replace(/-/g, "");
    const imageUrl = saveImageVariant(imagesDir, id, aspect_ratio, bytes, contentType!);

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
      // An uploaded image is not a generated page, so no idle-loop clip is ever made for it.
      video_status: null,
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
      return c.json({ ready: false }, 404);
    }
    return c.json({ ready: true, video_url: info.url });
  });

  // Transition-morph polling (PLAN §3 Phase 5): 404 until the pre-generated clip is ready — same
  // shape and reasoning as /video above. Morphs are never generated on demand, so a 404 here just
  // means "use the instant crossfade", not "come back later and block on it".
  app.get("/:id/morph", (c) => {
    const id = c.req.param("id");
    const info = getMorphInfo(id);
    if (!info || info.status !== "ready" || !info.url) {
      return c.json({ ready: false }, 404);
    }
    return c.json({ ready: true, morph_url: info.url });
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

    const { bytes, contentType } = await providers.image.generate({
      prompt: node.authored_prompt,
      aspectRatio: ratio,
    });
    const imageUrl = saveImageVariant(imagesDir, id, ratio, bytes, contentType);
    const updated = updateImageVariants(id, { ...node.image_variants, [ratio]: imageUrl });
    return c.json({ node: updated });
  });

  return app;
}
