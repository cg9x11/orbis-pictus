import crypto from "node:crypto";
import type {
  AspectRatio,
  GenerateEditRequest,
  GenerateEvent,
  GenerateRequest,
  GenerateSearchRequest,
  GenerateTapRequest,
  Node,
} from "@orbis/shared";
import { groupIdOf } from "@orbis/shared";
import type { Providers } from "../providers/index.js";
import { getNode, insertNode, insertVersionAsDefault, findChildBySubject, findNodeByPromptHash, resolveGroupDefault } from "../storage/nodes.js";
import { findTapCacheHit, recordTapCache } from "../storage/tapCache.js";
import { loadReferenceImageDataUrl, saveImageVariantResized } from "./imageStorage.js";
import { normalizeSubject } from "./normalize.js";
import { computePromptHash } from "./promptHash.js";
import type { VideoPipeline } from "./video.js";
import type { MorphPipeline } from "./morph.js";
import { getTapDedupMode } from "./config.js";
import { buildImagePrompt, resolveArtStyleName, resolveCompositionName } from "./artStyle.js";
import { boolConfig } from "../config/index.js";
import { estimateImageCost } from "../providers/image/pricing.js";
import { withRetry } from "../lib/retry.js";
import { InFlight } from "../lib/coalesce.js";
import type { ImageGenResult } from "../providers/types.js";

export interface GenerateContext {
  providers: Providers;
  imagesDir: string;
  video: VideoPipeline;
  morph: MorphPipeline;
}

// Stampede guard. It coalesces concurrent image generations that resolve to the same prompt hash.
// That hash is the same key that the persistent layer-3 cache uses. Two identical requests that
// both miss the cache now share a single provider call, instead of each one paying for it.
//
// The key is promptHash alone. This matches the reuse identity of the persistent cache. A
// reference image is not part of the key, because findNodeByPromptHash also ignores it.
const imageInFlight = new InFlight<ImageGenResult>();

/** What every mode resolves to before the authoring step and the drawing step start.
 *
 *  `topic` has the same meaning in every mode. It is the search query, the tap subject that the
 *  VLM described, or the topic that an edit inherits from its parent. It is never the raw edit
 *  command text. Later steps use it for the web search query, for node.query, and for the
 *  normalizedSubject of the cache layer.
 *
 *  Only resolveTapContext sets `tapReferenceImageDataUrl`. */
interface ModeContext {
  topic: string;
  parentNodeId: string | null;
  parentTitle: string | undefined;
  parentAuthoredPrompt: string | undefined;
  tapReferenceImageDataUrl: string | undefined;
  // Page versions (peer model). `nodeParentId` is the parent_id STORED on the new node. For search
  // and tap it is the page explored from. For an EDIT it is the edited version's OWN parent, so all
  // versions of a page share one exploration parent and stay out of each other's breadcrumb.
  nodeParentId: string | null;
  // Edit only: the group the new version joins, and the version it was edited from. Undefined for a
  // non-edit mode — a fresh page is its own group (the storage layer fills the group with its id).
  versionGroupId: string | undefined;
  editedFromId: string | undefined;
}

// Only tap mode can short-circuit the rest of generation. Layer 2 does this when an existing
// child already covers the subject. Search and edit always resolve to a context, never to a
// cache hit.
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
      nodeParentId: parentNodeId,
      versionGroupId: undefined,
      editedFromId: undefined,
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
      // An edit has no topic of its own. It is a re-render of the same page, so it inherits the
      // topic of the parent. It does not use the edit command itself (req.prompt, for example
      // "make it night time"). runGenerate passes that command to authorEdit() separately. If the
      // code used the edit command here, web search receives the edit instruction and this node
      // stores it as its query.
      topic: parent.query,
      parentNodeId,
      parentTitle: req.parent_title || parent.page_title,
      parentAuthoredPrompt: parent.authored_prompt,
      tapReferenceImageDataUrl: undefined,
      // Peer model: the new version attaches to the edited version's OWN parent (not to the edited
      // version), joins its group, and records that it was edited from it.
      nodeParentId: parent.parent_id,
      versionGroupId: groupIdOf(parent),
      editedFromId: parent.id,
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
  const parent = getNode(parentNodeId);

  // Layer 1: the coordinate-quantization VLM cache. On a hit, skip the VLM call entirely.
  const cacheHit = tapDedup !== "off" ? findTapCacheHit(parentNodeId, req.aspect_ratio, req.x, req.y) : null;
  let subject: string;
  if (cacheHit) {
    subject = cacheHit.subject;
  } else {
    subject = (await ctx.providers.llm.describeTap(req.markedImage)).subject;
    if (tapDedup !== "off") recordTapCache(parentNodeId, req.aspect_ratio, req.x, req.y, subject);
  }
  await emit({ event: "tap_subject", data: { subject } });

  // Layer 2: subject-level child dedup. Navigation to an existing child is instant, and it starts
  // no generation. The lookup finds the PRIMARY child of the subject (edit versions are excluded), so
  // resolve it to that group's current default — otherwise a repeat tap on a subject the user edited
  // and re-defaulted would open the old primary, not their chosen version.
  if (tapDedup === "reuse") {
    const existingChild = findChildBySubject(parentNodeId, normalizeSubject(subject));
    if (existingChild) {
      return { kind: "cache-hit", node: resolveGroupDefault(existingChild) };
    }
  }

  return {
    kind: "resolved",
    context: {
      topic: subject,
      parentNodeId,
      parentTitle: req.parent_title,
      parentAuthoredPrompt: parent?.authored_prompt,
      // Tap-mode scene continuity. This is the rendered image of the parent page. The code passes
      // it to the image provider as a reference, in the same way that edit mode passes the image
      // of the current page. The tap child then reuses the exact scene of the parent.
      tapReferenceImageDataUrl: parent ? loadReferenceImageDataUrl(ctx.imagesDir, parent, req.aspect_ratio) : undefined,
      nodeParentId: parentNodeId,
      versionGroupId: undefined,
      editedFromId: undefined,
    },
  };
}

/** Sharpens the web-search query with the title of the parent page as context.
 *
 *  Take an ambiguous tap subject or inherited topic, such as "the red tower". It then goes to
 *  search as what it really is inside the page that it came from. The result is "the red tower
 *  (in the context of Temples of Kyoto)".
 *
 *  The topic stays unchanged when there is no parent, or when it already contains the parent
 *  title. A full search query that the user typed is one such case. An edit whose inherited topic
 *  equals the parent is another.
 *
 *  This affects the *search* query only. node.query and the identity of the layer-2 cache and the
 *  layer-3 cache still use the bare `topic`. */
function buildSearchQuery(topic: string, parentTitle: string | undefined): string {
  const parent = parentTitle?.trim();
  if (!parent) return topic;
  if (topic.toLowerCase().includes(parent.toLowerCase())) return topic;
  return `${topic} (in the context of ${parent})`;
}

/** Runs the full generation pipeline and persists the resulting node. Calls `emit` for each SSE event. */
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

  const { topic, nodeParentId, parentTitle, parentAuthoredPrompt, tapReferenceImageDataUrl, versionGroupId, editedFromId } =
    resolution.context;

  let webSearchSummary: string | undefined;
  let webSearchDegraded = false;
  if (req.web_search) {
    await emit({ event: "stage", data: { stage: "searching" } });
    const searchResult = await ctx.providers.search.search(buildSearchQuery(topic, parentTitle));
    if (searchResult?.degraded) {
      // Degraded means that the summary holds model knowledge only, not verified web results
      // (see providers/search/llm.ts). Do NOT feed it to the author as grounded facts. That is
      // exactly the case where invented dates, prices, and hours slip onto the page.
      //
      // Drop the summary, so the author writes a general page from widely-known facts instead.
      // Also log the event. The provider already logged the underlying cause one time at startup.
      // This log line ties that cause to a specific generation.
      webSearchDegraded = true;
      console.warn(
        `[orbis] web search degraded to model-knowledge-only for topic "${topic}" — dropping summary; page will be written from general knowledge`,
      );
    } else {
      webSearchSummary = searchResult?.summary;
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

  // The authoring model named the page, so the longest part of the wait can now say what the
  // image model draws. That part is the image generation itself.
  await emit({ event: "stage", data: { stage: "drawing", pageTitle } });

  const nodeId = crypto.randomUUID().replace(/-/g, "");

  // VISUAL IDENTITY: authoredPrompt holds content only, that is the title, the layout, and the
  // exact text. The art style covers materials, palette, lighting, and composition. It is a fixed
  // constant that the code appends here. The LLM never authors it, so every page shares one house
  // look, whatever the topic is.
  //
  // Search never carries a reference image. Tap and edit both carry one, the parent frame or the
  // current image. For those two modes, the framing asks the model to keep the scene of that
  // reference as the base.
  const imagePrompt = buildImagePrompt(authoredPrompt, req.art_style, {
    reference: req.mode === "search" ? "none" : "reuse",
    composition: req.composition,
  });

  // Layer 3: the prompt-hash image cache. Its key is the full built prompt, so a change to
  // ART_STYLE also invalidates it. Edit mode is excluded. An edit is conditioned on the actual
  // pixels of the current page (referenceImageDataUrl). Two edits that author byte-identical
  // prompt text can therefore still need genuinely different output images.
  //
  // The cache is also excluded when the tap panel asked for a new version outright. That request
  // is a deliberate spend by the user. Stored pixels in return are a broken promise, not a saving.
  // The flag drops BOTH the cache read and the in-flight coalescing below. Two such clicks that
  // land together must produce two drawings. If they do not, the second user gets the image of
  // the first one.
  const forceNewImage = req.mode === "tap" && req.force_new_image;
  const canReuseImage = req.mode !== "edit" && !forceNewImage;
  const promptHash = computePromptHash(imagePrompt, req.aspect_ratio, ctx.providers.image.modelId, ctx.providers.image.providerId);
  const cachedImageNode = canReuseImage ? findNodeByPromptHash(promptHash) : null;
  const cachedImageUrl = cachedImageNode?.image_variants[req.aspect_ratio];

  // Opt-in prompt inspection (env DEBUG_IMAGE_PROMPT=true). It prints the exact, fully-built
  // prompt that goes to the image model. That prompt is the authored content plus the appended
  // art style. It also prints the settings that shaped the prompt. The log runs whether or not
  // the layer-3 cache serves the image back, so `served_from_cache` tells which case happened.
  const debugImagePrompt = boolConfig("DEBUG_IMAGE_PROMPT", (c) => c.debug?.imagePrompt, false);
  if (debugImagePrompt) {
    const reference =
      req.mode === "edit" ? "current page image (edit)" : tapReferenceImageDataUrl ? "parent page frame (tap)" : "none";
    // The web search summary (call 1) grounds the authored content (call 2). A log of the summary
    // next to the final prompt shows exactly what the search returned and what the author LLM then
    // wrote. Any embellishment beyond the sources appears in the difference between the two.
    const search = !req.web_search
      ? "off"
      : webSearchDegraded
        ? "on (DEGRADED — summary dropped, page written from general knowledge)"
        : webSearchSummary
          ? "on"
          : "on (no summary returned)";
    console.log(
      `\n[image-prompt] mode=${req.mode} aspect=${req.aspect_ratio} style=${req.art_style ?? "(server default)"} ` +
        `reference=${reference} served_from_cache=${Boolean(cachedImageUrl)} model=${ctx.providers.image.modelId}\n` +
        `[image-prompt] web_search=${search}\n` +
        `[image-prompt] web_search summary: ${webSearchSummary ?? "(none)"}\n` +
        `[image-prompt] page_title: ${pageTitle}\n` +
        `[image-prompt] full prompt:\n${imagePrompt}\n`,
    );
  }

  let imageUrl: string;
  // Which model actually drew these pixels. It starts as the model that the code asked for. The
  // code below corrects it whenever that is not the truth. A provider-internal fallback (the
  // quota retry of Ark) and an unknown-model fallback both report the substitute in
  // `usedModelId`.
  //
  // This stays separate from `providers.image.modelId`. The code computes the prompt hash above
  // from the REQUESTED model, before generation runs. It must stay that way, so that the cache
  // key is stable.
  let drawnModelId = ctx.providers.image.modelId;
  if (cachedImageUrl) {
    imageUrl = cachedImageUrl;
    // These pixels came from an earlier node, so credit the model that drew them there. The hash
    // keys on the requested model, so a hit means the same request. In some cases that earlier
    // generation itself used a fallback, and only its record is accurate.
    if (cachedImageNode?.image_model) drawnModelId = cachedImageNode.image_model;
  } else {
    const genImage = (): Promise<ImageGenResult> =>
      ctx.providers.image.generate({
        prompt: imagePrompt,
        aspectRatio: req.aspect_ratio,
        referenceImageDataUrl: req.mode === "edit" ? req.currentImage : tapReferenceImageDataUrl,
      });
    // The code coalesces reusable (non-edit) generations only. An edit is conditioned on the
    // actual pixels of the current page. Two edits with byte-identical prompts can therefore still
    // need different images, and each one must run. This is the same reason that excludes them
    // from the persistent cache above.
    const { bytes, contentType, usage, usedModelId } = canReuseImage ? await imageInFlight.run(promptHash, genImage) : await genImage();
    if (usedModelId) drawnModelId = usedModelId;
    imageUrl = await saveImageVariantResized(ctx.imagesDir, nodeId, req.aspect_ratio, bytes, contentType);

    // The same DEBUG_IMAGE_PROMPT flag. After a real generation, log the token usage that the
    // provider reported and an estimated cost from the published per-model rate table
    // (providers/image/pricing.ts). This applies only to providers that return usage (Gemini,
    // OpenAI). Other providers log "n/a". A cache hit never logs this line.
    if (debugImagePrompt) {
      // The price uses the model that actually drew the image, not the model that the code asked
      // for. A fallback to a different model is billed at the rate of the fallback.
      const cost = estimateImageCost(drawnModelId, usage);
      const tokens = usage
        ? `in=${usage.inputTokens ?? "?"} out=${usage.outputTokens ?? "?"} total=${usage.totalTokens ?? "?"}`
        : "n/a (provider reports no token usage)";
      console.log(
        `[image-prompt] usage: ${tokens} | est. cost: ${cost ? `~$${cost.usd.toFixed(4)} (in $${cost.rate.inputPerM}/M, out $${cost.rate.outputPerM}/M)` : "n/a (no rate for this model)"}\n`,
      );
    }
  }

  await emit({ event: "preview", data: { aspectRatio: req.aspect_ratio, imageUrl } });

  const node: Node = {
    id: nodeId,
    parent_id: nodeParentId,
    session_id: req.session_id,
    query: topic,
    page_title: pageTitle,
    image_variants: { [req.aspect_ratio]: imageUrl },
    image_model: drawnModelId,
    // Provenance. A lazily-generated aspect-ratio variant can reproduce this page from these
    // values. Without them, it uses whatever the server configuration holds at the moment of the
    // first request for that variant. The style and the composition are the RESOLVED names, not
    // the raw request values, so an unrecognized request value records what the code actually
    // drew.
    image_provider: ctx.providers.image.providerId,
    art_style: resolveArtStyleName(req.art_style),
    composition: resolveCompositionName(req.composition),
    prompt_author_model: ctx.providers.llm.modelId,
    authored_prompt: authoredPrompt,
    created_at: new Date().toISOString(),
    version: 1,
    video_status: null,
    morph_status: null,
    // Page versions. For a non-edit these are undefined/null, so the storage layer makes the node its
    // own group and its own default. For an edit they carry the group, the source version, and the
    // command, and insertVersionAsDefault (below) makes this the group's new default.
    version_group_id: versionGroupId,
    edited_from_id: editedFromId ?? null,
    edit_command: req.mode === "edit" ? req.prompt : null,
  };

  // An edit joins an existing version group and becomes its default, so the old default must be
  // cleared in the same transaction (insertVersionAsDefault). withRetry wraps the whole call, so a
  // retry re-runs the clear and the insert atomically. Every other mode is a fresh page and its own
  // group, so a plain insert is right.
  const persist = req.mode === "edit" ? insertVersionAsDefault : insertNode;
  await withRetry(() =>
    persist(node, { normalizedSubject: normalizeSubject(topic), promptHash: canReuseImage ? promptHash : null }),
  );

  // Fire-and-forget background clips. They start BEFORE the code announces `complete`.
  //
  // Both calls are synchronous up to the point where they mark the node pending. Only the actual
  // provider request is deferred. The re-read of the node below therefore returns video_status
  // "pending" whenever a clip is genuinely on its way. An emit of `complete` first ships a payload
  // with null, and the client must read that as "no clip will ever exist". The page then never
  // picks up the loop that it is about to have.
  //
  // Neither call can block the page or fail it. Every guard is inside the call, and a root node
  // makes the morph a no-op, because there is no parent to morph from.
  //
  // Spend video quota only when the user has Live video on (req.video_loop). Without this check,
  // every generation burned idle-loop quota AND morph quota even with the toggle off. The client
  // gated the display, but nothing gated the generation. When the code skips the calls,
  // video_status and morph_status stay null. The client already reads that as "no clip will ever
  // exist" and never polls, so nothing waits on them.
  if (req.video_loop) {
    // The clip settings of the UI ride the same request, so both background clips use what the
    // user picked. This code does not filter unusable values. videoConfig.ts falls an unknown
    // resolution back to the configured one, and it caps a client-supplied duration. Whatever
    // these values carry is therefore always something that the provider accepts.
    const clipOptions = { resolution: req.video_resolution, durationSeconds: req.video_duration_seconds };
    ctx.video.maybeStartIdleLoop(node, ctx.providers, ctx.imagesDir, clipOptions);
    ctx.morph.maybeStartMorph(node, ctx.providers, ctx.imagesDir, clipOptions);
  }

  const completed = getNode(nodeId) ?? node;
  await emit({ event: "complete", data: completed });

  return completed;
}
