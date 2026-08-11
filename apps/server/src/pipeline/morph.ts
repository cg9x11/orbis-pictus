import { predecessorId, type AspectRatio, type Node } from "@orbis/shared";
import type { Providers } from "../providers/index.js";
import { getMorphInfo, getNode, markMorphFailed, markMorphPending, markMorphReady } from "../storage/nodes.js";
import { saveMorph, writeReversedMorph } from "./morphStorage.js";
import { getMorphMaxPerSession, getMorphVideoModel, isEditMorphEnabled, isMorphEnabled, isMorphReverseEnabled } from "./morphConfig.js";
import { MORPH_TRANSITION_MOTION_PROMPT } from "./videoPrompt.js";
import { createBackgroundClipPipeline, type ClipOptions, type StartNowResult } from "./backgroundClip.js";

const RATIO_PREFERENCE: AspectRatio[] = ["16:9", "3:4", "1:1"];

/** The first aspect ratio both nodes have an image for - first/last frame must be the same shape. */
function pickSharedRatio(parent: Node, child: Node): AspectRatio | null {
  for (const ratio of RATIO_PREFERENCE) {
    if (parent.image_variants[ratio] && child.image_variants[ratio]) return ratio;
  }
  return null;
}

export interface MorphPipeline {
  /**
   * Fire-and-forget: kicks off background transition-morph generation for `child` if the feature
   * is on and every guard passes. Never awaited by callers - navigation must
   * never wait on a morph. Safe to call for every completed page unconditionally; a node with no
   * parent (a root/search result) is simply skipped inside.
   */
  maybeStartMorph(child: Node, providers: Providers, imagesDir: string, options?: ClipOptions): void;
  /**
   * Explicit, user-triggered counterpart for a child created without a morph (Live video was off at
   * the time, or the page was reopened from a cached tap marker, which never runs the generate
   * pipeline at all). Without this a morph could only ever be made in the one instant the child was
   * created - miss it and no action anywhere in the app could produce one. Returns why nothing
   * started when it didn't, so the route can answer the user.
   */
  startMorphNow(child: Node, providers: Providers, imagesDir: string, options?: ClipOptions): StartNowResult;
}

/** Factory (not a bare singleton) so tests can get isolated in-flight/session-cap state - see morph.test.ts. */
export function createMorphPipeline(): MorphPipeline {
  const pipeline = createBackgroundClipPipeline({
    label: "morph generation",
    isEnabled: isMorphEnabled,
    maxPerSession: getMorphMaxPerSession,
    getStatus: getMorphInfo,
    buildRequest: (child) => {
      // An edit (a new version) carries edited_from_id; a plain tap child does not. Edit transitions
      // are gated behind their own flag (default off) so turning morphs on lights up tap transitions
      // without spending quota on every small edit. Skipping here (return null) covers both the
      // automatic and the user-triggered path - the latter simply reports "unavailable".
      if (child.edited_from_id && !isEditMorphEnabled()) return null;

      // The morph runs from the page the user came from, to this one - the child's predecessor.
      const sourceId = predecessorId(child);
      if (!sourceId) return null; // a root page that is not an edit has nothing to morph from
      const source = getNode(sourceId);
      if (!source) return null;

      const ratio = pickSharedRatio(source, child);
      if (!ratio) return null; // no image both nodes share the same aspect ratio for - skip rather than generate one

      // A tap child carries where it was tapped on the source page; hand that to the pipeline so the
      // motion prompt aims the push at that spot. Absent on edits and legacy taps - then the morph is
      // un-aimed, exactly as before this feature.
      const markerPoint =
        child.tap_x != null && child.tap_y != null ? { x: child.tap_x, y: child.tap_y } : undefined;

      return {
        prompt: MORPH_TRANSITION_MOTION_PROMPT,
        aspectRatio: ratio,
        firstFrameUrl: source.image_variants[ratio]!,
        lastFrameUrl: child.image_variants[ratio]!,
        markerPoint,
        // Unlock the camera ONLY when there is a tap target to dive toward. A marker-less morph (an
        // edit, or a legacy tap with no coords) keeps the camera locked, matching the "hold steady"
        // branch of the motion prompt - otherwise it could drift when it should sit still.
        cameraFixed: !markerPoint,
      };
    },
    markPending: markMorphPending,
    markReady: markMorphReady,
    markFailed: markMorphFailed,
    // The reversed copy is written after the clip itself and deliberately not awaited: it is only
    // needed if the user later steps back from this child, and making `markReady` wait on ffmpeg
    // would hold up the forward transition that is being waited on right now. If it loses the race
    // (or ffmpeg is absent) the client simply crossfades back instead.
    save: (imagesDir, nodeId, bytes) => {
      const url = saveMorph(imagesDir, nodeId, bytes);
      if (isMorphReverseEnabled()) void writeReversedMorph(imagesDir, nodeId);
      return url;
    },
    videoModel: getMorphVideoModel,
    describeMotion: async ({ firstFrameDataUrl, lastFrameDataUrl }, providers) =>
      lastFrameDataUrl ? (await providers.llm.describeMorphMotion(firstFrameDataUrl, lastFrameDataUrl)).motionPrompt : undefined,
  });

  return { maybeStartMorph: pipeline.maybeStart, startMorphNow: pipeline.startNow };
}

/** The real app's single shared instance - routes import this. */
export const morphPipeline = createMorphPipeline();
