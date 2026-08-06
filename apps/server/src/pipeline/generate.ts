import crypto from "node:crypto";
import type {
  GenerateEditRequest,
  GenerateEvent,
  GenerateRequest,
  GenerateSearchRequest,
  GenerateTapRequest,
  Node,
} from "@flipbook/shared";
import type { Providers } from "../providers/index.js";
import { getNode, insertNode, findChildBySubject, findNodeByPromptHash } from "../storage/nodes.js";
import { findTapCacheHit, recordTapCache } from "../storage/tapCache.js";
import { loadReferenceImageDataUrl, saveImageVariant } from "./imageStorage.js";
import { normalizeSubject } from "./normalize.js";
import { computePromptHash } from "./promptHash.js";
import type { VideoPipeline } from "./video.js";
import type { MorphPipeline } from "./morph.js";
import { getTapDedupMode } from "./config.js";
import { buildImagePrompt } from "./houseStyle.js";
import { withRetry } from "../lib/retry.js";
import { InFlight } from "../lib/coalesce.js";
import type { ImageGenResult } from "../providers/types.js";

export interface GenerateContext {
  providers: Providers;
  imagesDir: string;
  video: VideoPipeline;
  morph: MorphPipeline;
}

// PLAN §2.3 stampede guard: coalesce concurrent image generations that resolve to the same
// prompt-hash (the same key the persistent layer-3 cache uses). Two identical requests that both
// miss the cache now share a single provider call instead of each paying for it. Keyed by
// promptHash alone — matching the persistent cache's own reuse identity — so a reference image is
// deliberately not part of the key, exactly as findNodeByPromptHash already treats it.
const imageInFlight = new InFlight<ImageGenResult>();

/** What every mode resolves to before authoring/drawing begins. `topic` is consistently the same
 *  meaning regardless of mode (the search query, the VLM-described tap subject, or the parent's
 *  inherited topic for an edit — never the raw edit command text): used afterwards for the web
 *  search query, node.query, and the cache-layer normalizedSubject. `tapReferenceImageDataUrl` is
 *  only ever set by resolveTapContext. */
interface ModeContext {
  topic: string;
  parentNodeId: string | null;
  parentTitle: string | undefined;
  parentAuthoredPrompt: string | undefined;
  tapReferenceImageDataUrl: string | undefined;
}

// Only tap mode can short-circuit the rest of generation (PLAN §2.3 layer 2: an existing child
// already covers this subject) — search and edit always resolve to a context, never a cache hit.
type ModeResolution = { kind: "resolved"; context: ModeContext } | { kind: "cache-hit"; node: Node };

function resolveSearchContext(req: GenerateSearchRequest): ModeResolution {
  const parentNodeId = req.current_node_id || null;
  const parent = parentNodeId ? getNode(parentNodeId) : null;
  return {
    kind: "resolved",
    context: {
      topic: req.query,
      parentNodeId,
      parentTitle: parent?.page_title,
      parentAuthoredPrompt: parent?.authored_prompt,
      tapReferenceImageDataUrl: undefined,
    },
  };
}

function resolveEditContext(req: GenerateEditRequest): ModeResolution {
  const parentNodeId = req.current_node_id;
  const parent = getNode(parentNodeId);
  if (!parent) throw new Error(`Cannot edit: parent node ${parentNodeId} not found`);
  return {
    kind: "resolved",
    context: {
      // An edit has no topic of its own — it's a re-render of the same page, so it inherits the
      // parent's topic rather than using the edit command itself (req.prompt, e.g. "make it night
      // time"). That command is passed separately to authorEdit() in runGenerate; using it here
      // instead would mean web-searching the edit instruction and persisting it as this node's query.
      topic: parent.query,
      parentNodeId,
      parentTitle: req.parent_title || parent.page_title,
      parentAuthoredPrompt: parent.authored_prompt,
      tapReferenceImageDataUrl: undefined,
    },
  };
}

async function resolveTapContext(
  req: GenerateTapRequest,
  ctx: GenerateContext,
  emit: (event: GenerateEvent) => void | Promise<void>,
): Promise<ModeResolution> {
  const parentNodeId = req.current_node_id;
  const tapDedup = getTapDedupMode();

  // Layer 1 (PLAN §2.3): coordinate-quantization VLM cache — skip the VLM call entirely on a hit.
  const cacheHit = tapDedup !== "off" ? findTapCacheHit(parentNodeId, req.aspect_ratio, req.x, req.y) : null;
  let subject: string;
  if (cacheHit) {
    subject = cacheHit.subject;
  } else {
    subject = (await ctx.providers.llm.describeTap(req.markedImage)).subject;
    if (tapDedup !== "off") recordTapCache(parentNodeId, req.aspect_ratio, req.x, req.y, subject);
  }
  await emit({ event: "tap_subject", data: { subject } });

  // Layer 2: subject-level child dedup — instant navigation to an existing child, zero generation.
  if (tapDedup === "reuse") {
    const existingChild = findChildBySubject(parentNodeId, normalizeSubject(subject));
    if (existingChild) return { kind: "cache-hit", node: existingChild };
  }

  const parentNode = getNode(parentNodeId);
  return {
    kind: "resolved",
    context: {
      topic: subject,
      parentNodeId,
      parentTitle: req.parent_title,
      parentAuthoredPrompt: parentNode?.authored_prompt,
      // Tap-mode scene continuity (PLAN §4 tap mode): the parent page's own rendered image, passed
      // to the image provider as a reference the same way edit mode passes the current page's
      // image — verified against the real flipbook.page, whose tap child reuses the parent's exact
      // scene.
      tapReferenceImageDataUrl: parentNode ? loadReferenceImageDataUrl(ctx.imagesDir, parentNode, req.aspect_ratio) : undefined,
    },
  };
}

/** Runs the full generation pipeline (PLAN §2.2), calling `emit` for each SSE event, and persists the resulting node. */
export async function runGenerate(
  req: GenerateRequest,
  ctx: GenerateContext,
  emit: (event: GenerateEvent) => void | Promise<void>,
): Promise<Node> {
  await emit({ event: "start", data: {} });

  const resolution =
    req.mode === "tap"
      ? await resolveTapContext(req, ctx, emit)
      : req.mode === "edit"
        ? resolveEditContext(req)
        : resolveSearchContext(req);

  if (resolution.kind === "cache-hit") {
    await emit({ event: "complete", data: resolution.node });
    return resolution.node;
  }

  const { topic, parentNodeId, parentTitle, parentAuthoredPrompt, tapReferenceImageDataUrl } = resolution.context;

  let webSearchSummary: string | undefined;
  if (req.web_search) {
    await emit({ event: "stage", data: { stage: "searching" } });
    const searchResult = await ctx.providers.search.search(topic);
    webSearchSummary = searchResult?.summary;
    if (searchResult?.degraded) {
      // The provider already logged the underlying cause once at startup (see
      // providers/search/llm.ts's logNoWebSearch) — this ties a specific generation's authored
      // content to that same degradation, since authorPrompt/authorEdit below still receive this
      // summary as if it were a real search result.
      console.warn(`[flipbook] web search degraded to model-knowledge-only for topic "${topic}"`);
    }
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
    const genImage = (): Promise<ImageGenResult> =>
      ctx.providers.image.generate({
        prompt: imagePrompt,
        aspectRatio: req.aspect_ratio,
        referenceImageDataUrl: req.mode === "edit" ? req.currentImage : tapReferenceImageDataUrl,
      });
    // Only reusable (non-edit) generations are coalesced: an edit is conditioned on the current
    // page's actual pixels, so two edits with byte-identical prompts can still need different
    // images and must each run — the same reason they are excluded from the persistent cache above.
    const { bytes, contentType } = canReuseImage ? await imageInFlight.run(promptHash, genImage) : await genImage();
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
    morph_status: null,
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
  ctx.video.maybeStartIdleLoop(node, ctx.providers, ctx.imagesDir);
  ctx.morph.maybeStartMorph(node, ctx.providers, ctx.imagesDir);

  const completed = getNode(nodeId) ?? node;
  await emit({ event: "complete", data: completed });

  return completed;
}
