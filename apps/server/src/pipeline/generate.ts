import crypto from "node:crypto";
import type { GenerateEvent, GenerateRequest, Node } from "@flipbook/shared";
import type { Providers } from "../providers/index.js";
import { getNode, insertNode, findChildBySubject, findNodeByPromptHash } from "../storage/nodes.js";
import { findTapCacheHit, recordTapCache } from "../storage/tapCache.js";
import { saveImageVariant } from "./imageStorage.js";
import { normalizeSubject } from "./normalize.js";
import { computePromptHash } from "./promptHash.js";
import { getTapDedupMode } from "./config.js";
import { withRetry } from "../lib/retry.js";

export interface GenerateContext {
  providers: Providers;
  imagesDir: string;
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
    const tapDedup = getTapDedupMode();

    // Layer 1 (PLAN §2.3): coordinate-quantization VLM cache — skip the VLM call entirely on a hit.
    const cacheHit = tapDedup !== "off" ? findTapCacheHit(parentNodeId, req.aspect_ratio, req.x, req.y) : null;
    let subject: string;
    if (cacheHit) {
      subject = cacheHit.subject;
    } else {
      subject = (await ctx.providers.llm.describeTap(req.image)).subject;
      if (tapDedup !== "off") recordTapCache(parentNodeId, req.aspect_ratio, req.x, req.y, subject);
    }
    await emit({ event: "tap_subject", data: { subject } });

    // Layer 2: subject-level child dedup — instant navigation to an existing child, zero generation.
    if (tapDedup === "reuse") {
      const existingChild = findChildBySubject(parentNodeId, normalizeSubject(subject));
      if (existingChild) {
        await emit({ event: "complete", data: existingChild });
        return existingChild;
      }
    }

    topic = subject;
    parentTitle = req.parent_title;
    parentAuthoredPrompt = getNode(parentNodeId)?.authored_prompt;
  } else if (req.mode === "edit") {
    parentNodeId = req.current_node_id;
    const parent = getNode(parentNodeId);
    if (!parent) throw new Error(`Cannot edit: parent node ${parentNodeId} not found`);
    topic = req.prompt;
    parentTitle = req.parent_title || parent.page_title;
    parentAuthoredPrompt = parent.authored_prompt;
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

  const { pageTitle, authoredPrompt } =
    req.mode === "edit"
      ? await ctx.providers.llm.authorEdit({
          command: req.prompt,
          parentAuthoredPrompt: parentAuthoredPrompt!,
          parentTitle,
          webSearchSummary,
        })
      : await ctx.providers.llm.authorPrompt({
          topic,
          parentTitle,
          parentAuthoredPrompt,
          webSearchSummary,
        });

  const nodeId = crypto.randomUUID().replace(/-/g, "");

  // Layer 3 (PLAN §2.3): prompt-hash image cache. Excluded for edit mode — edits are conditioned
  // on the current page's actual pixels (referenceImageDataUrl), so two edits that happen to
  // author byte-identical prompt text can still need genuinely different output images.
  const canReuseImage = req.mode !== "edit";
  const promptHash = computePromptHash(authoredPrompt, req.aspect_ratio, ctx.providers.image.modelId, ctx.providers.image.providerId);
  const cachedImageNode = canReuseImage ? findNodeByPromptHash(promptHash) : null;
  const cachedImageUrl = cachedImageNode?.image_variants[req.aspect_ratio];

  let imageUrl: string;
  if (cachedImageUrl) {
    imageUrl = cachedImageUrl;
  } else {
    const { bytes, contentType } = await ctx.providers.image.generate({
      prompt: authoredPrompt,
      aspectRatio: req.aspect_ratio,
      referenceImageDataUrl: req.mode === "edit" ? req.image : undefined,
    });
    imageUrl = saveImageVariant(ctx.imagesDir, nodeId, req.aspect_ratio, bytes, contentType);
  }

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

  await withRetry(() =>
    insertNode(node, { normalizedSubject: normalizeSubject(topic), promptHash: canReuseImage ? promptHash : null }),
  );

  await emit({ event: "complete", data: node });

  return node;
}
