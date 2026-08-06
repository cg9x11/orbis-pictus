import crypto from "node:crypto";
import type { GenerateEvent, GenerateRequest, Node } from "@flipbook/shared";
import type { Providers } from "../providers/index.js";
import { getNode, insertNode, findChildBySubject, findNodeByPromptHash } from "../storage/nodes.js";
import { findTapCacheHit, recordTapCache } from "../storage/tapCache.js";
import { loadReferenceImageDataUrl, saveImageVariant } from "./imageStorage.js";
import { normalizeSubject } from "./normalize.js";
import { computePromptHash } from "./promptHash.js";
import { videoPipeline } from "./video.js";
import { morphPipeline } from "./morph.js";
import { getTapDedupMode } from "./config.js";
import { buildImagePrompt } from "./houseStyle.js";
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
  // Tap-mode scene continuity (PLAN §4 tap mode): the parent page's own rendered image, passed to
  // the image provider as a reference the same way edit mode passes the current page's image —
  // verified against the real flipbook.page, whose tap child reuses the parent's exact scene.
  let tapReferenceImageDataUrl: string | undefined;

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
    const parentNode = getNode(parentNodeId);
    parentAuthoredPrompt = parentNode?.authored_prompt;
    tapReferenceImageDataUrl = parentNode ? loadReferenceImageDataUrl(ctx.imagesDir, parentNode, req.aspect_ratio) : undefined;
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

  let webSearchSummary: string | undefined;
  if (req.web_search) {
    await emit({ event: "stage", data: { stage: "searching" } });
    webSearchSummary = (await ctx.providers.search.search(topic))?.summary;
  }

  await emit({ event: "stage", data: { stage: "authoring" } });
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

  // The authoring model has now named the page, so the longest stretch of the wait — the image
  // model actually drawing — can at least say what it is drawing.
  await emit({ event: "stage", data: { stage: "drawing", pageTitle } });

  const nodeId = crypto.randomUUID().replace(/-/g, "");

  // PLAN §2 VISUAL IDENTITY: authoredPrompt is content-only (title, layout, exact text) — the
  // house style (materials/palette/lighting/composition) is a fixed constant appended here, never
  // authored by the LLM, so every page shares one house look regardless of topic.
  const imagePrompt = buildImagePrompt(authoredPrompt, req.house_style);

  // Layer 3 (PLAN §2.3): prompt-hash image cache, keyed on the full built prompt so a HOUSE_STYLE
  // change invalidates it too. Excluded for edit mode — edits are conditioned on the current
  // page's actual pixels (referenceImageDataUrl), so two edits that happen to author byte-identical
  // prompt text can still need genuinely different output images.
  const canReuseImage = req.mode !== "edit";
  const promptHash = computePromptHash(imagePrompt, req.aspect_ratio, ctx.providers.image.modelId, ctx.providers.image.providerId);
  const cachedImageNode = canReuseImage ? findNodeByPromptHash(promptHash) : null;
  const cachedImageUrl = cachedImageNode?.image_variants[req.aspect_ratio];

  let imageUrl: string;
  if (cachedImageUrl) {
    imageUrl = cachedImageUrl;
  } else {
    const { bytes, contentType } = await ctx.providers.image.generate({
      prompt: imagePrompt,
      aspectRatio: req.aspect_ratio,
      referenceImageDataUrl: req.mode === "edit" ? req.image : tapReferenceImageDataUrl,
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
    video_status: null,
  };

  await withRetry(() =>
    insertNode(node, { normalizedSubject: normalizeSubject(topic), promptHash: canReuseImage ? promptHash : null }),
  );

  // Fire-and-forget background clips (PLAN §3 Phase 5), started BEFORE `complete` is announced.
  // Both calls are synchronous up to the point where they mark the node pending — only the actual
  // provider request is deferred — so re-reading the node below yields video_status "pending"
  // whenever a clip is genuinely on its way. Emitting `complete` first would ship a payload saying
  // null, which the client is required to read as "no clip will ever exist", and the page would
  // never pick up the loop it is about to have. Neither call can block or fail the page: every
  // guard is inside, and a root node simply no-ops the morph (no parent to morph from).
  videoPipeline.maybeStartIdleLoop(node, ctx.providers, ctx.imagesDir);
  morphPipeline.maybeStartMorph(node, ctx.providers, ctx.imagesDir);

  const completed = getNode(nodeId) ?? node;
  await emit({ event: "complete", data: completed });

  return completed;
}
