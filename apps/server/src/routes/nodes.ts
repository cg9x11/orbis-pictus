import crypto from "node:crypto";
import { Hono } from "hono";
import { AspectRatioSchema, NodesCreateRequestSchema, NodesUploadRequestSchema, type Node } from "@flipbook/shared";
import { getHistory, getNode, insertNode, listGalleryNodes, updateImageVariants } from "../storage/nodes.js";
import { saveImageVariant } from "../pipeline/imageStorage.js";
import { normalizeSubject } from "../pipeline/normalize.js";
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
  // nodes, zero new generations.
  app.get("/", (c) => {
    const limitParam = Number(c.req.query("limit"));
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_GALLERY_LIMIT) : DEFAULT_GALLERY_LIMIT;
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
    };
    insertNode(node, { normalizedSubject: normalizeSubject(title), promptHash: null });
    return c.json({ node }, 201);
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
