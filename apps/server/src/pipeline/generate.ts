import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AspectRatio, GenerateEvent, GenerateRequest, Node } from "@flipbook/shared";
import type { Providers } from "../providers/index.js";
import { getNode, insertNode } from "../storage/nodes.js";

export interface GenerateContext {
  providers: Providers;
  imagesDir: string;
}

const VARIANT_NAME: Record<AspectRatio, string> = {
  "3:4": "portrait",
  "1:1": "square",
  "16:9": "landscape",
};

function extFromContentType(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  return "jpg";
}

/** Runs the full generation pipeline (PLAN §2.2), calling `emit` for each SSE event, and persists the resulting node. */
export async function runGenerate(
  req: GenerateRequest,
  ctx: GenerateContext,
  emit: (event: GenerateEvent) => void | Promise<void>,
): Promise<Node> {
  await emit({ event: "start", data: {} });

  let topic: string;
  let parentNodeId: string | null;
  let parentTitle: string | undefined;
  let parentAuthoredPrompt: string | undefined;

  if (req.mode === "tap") {
    parentNodeId = req.current_node_id;
    const { subject } = await ctx.providers.llm.describeTap(req.image);
    await emit({ event: "tap_subject", data: { subject } });
    topic = subject;
    parentTitle = req.parent_title;
    parentAuthoredPrompt = getNode(parentNodeId)?.authored_prompt;
  } else {
    topic = req.query;
    parentNodeId = req.current_node_id || null;
    if (parentNodeId) {
      const parent = getNode(parentNodeId);
      parentTitle = parent?.page_title;
      parentAuthoredPrompt = parent?.authored_prompt;
    }
  }

  const webSearchSummary = req.web_search ? (await ctx.providers.search.search(topic))?.summary : undefined;

  const { pageTitle, authoredPrompt } = await ctx.providers.llm.authorPrompt({
    topic,
    parentTitle,
    parentAuthoredPrompt,
    webSearchSummary,
  });

  const nodeId = crypto.randomUUID().replace(/-/g, "");

  const { bytes, contentType } = await ctx.providers.image.generate({
    prompt: authoredPrompt,
    aspectRatio: req.aspect_ratio,
  });

  const variant = VARIANT_NAME[req.aspect_ratio];
  const ext = extFromContentType(contentType);
  const nodeDir = path.join(ctx.imagesDir, nodeId);
  fs.mkdirSync(nodeDir, { recursive: true });
  fs.writeFileSync(path.join(nodeDir, `${variant}.${ext}`), bytes);
  const imageUrl = `/images/${nodeId}/${variant}.${ext}`;

  await emit({ event: "preview", data: { aspectRatio: req.aspect_ratio, imageUrl } });

  const node: Node = {
    id: nodeId,
    parent_id: parentNodeId,
    session_id: req.session_id,
    query: topic,
    page_title: pageTitle,
    image_variants: { [req.aspect_ratio]: imageUrl },
    image_model: ctx.providers.image.modelId,
    prompt_author_model: ctx.providers.llm.modelId,
    authored_prompt: authoredPrompt,
    created_at: new Date().toISOString(),
    version: 1,
  };
  insertNode(node);

  await emit({ event: "complete", data: node });

  return node;
}
