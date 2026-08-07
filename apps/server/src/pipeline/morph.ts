import type { AspectRatio, Node } from "@flipbook/shared";
import type { Providers } from "../providers/index.js";
import { getMorphInfo, getNode, markMorphFailed, markMorphPending, markMorphReady } from "../storage/nodes.js";
import { saveMorph } from "./morphStorage.js";
import { getMorphMaxPerSession, getMorphVideoModel, isMorphEnabled } from "./morphConfig.js";
import { MORPH_TRANSITION_MOTION_PROMPT } from "./videoPrompt.js";
import { createBackgroundClipPipeline } from "./backgroundClip.js";

const RATIO_PREFERENCE: AspectRatio[] = ["16:9", "3:4", "1:1"];

/** The first aspect ratio both nodes have an image for — first/last frame must be the same shape. */
function pickSharedRatio(parent: Node, child: Node): AspectRatio | null {
  for (const ratio of RATIO_PREFERENCE) {
    if (parent.image_variants[ratio] && child.image_variants[ratio]) return ratio;
  }
  return null;
}

export interface MorphPipeline {
  /**
   * Fire-and-forget: kicks off background transition-morph generation for `child` if the feature
   * is on and every guard passes (PLAN §3 Phase 5). Never awaited by callers — navigation must
   * never wait on a morph. Safe to call for every completed page unconditionally; a node with no
   * parent (a root/search result) is simply skipped inside.
   */
  maybeStartMorph(child: Node, providers: Providers, imagesDir: string): void;
}

/** Factory (not a bare singleton) so tests can get isolated in-flight/session-cap state — see morph.test.ts. */
export function createMorphPipeline(): MorphPipeline {
  const pipeline = createBackgroundClipPipeline({
    label: "morph generation",
    isEnabled: isMorphEnabled,
    maxPerSession: getMorphMaxPerSession,
    getStatus: getMorphInfo,
    buildRequest: (child) => {
      if (!child.parent_id) return null; // only a tap/edit child has a parent to morph from
      const parent = getNode(child.parent_id);
      if (!parent) return null;

      const ratio = pickSharedRatio(parent, child);
      if (!ratio) return null; // no image both nodes share the same aspect ratio for — skip rather than generate one

      return {
        prompt: MORPH_TRANSITION_MOTION_PROMPT,
        aspectRatio: ratio,
        firstFrameUrl: parent.image_variants[ratio]!,
        lastFrameUrl: child.image_variants[ratio]!,
      };
    },
    markPending: markMorphPending,
    markReady: markMorphReady,
    markFailed: markMorphFailed,
    save: saveMorph,
    videoModel: getMorphVideoModel,
    describeMotion: async ({ firstFrameDataUrl, lastFrameDataUrl }, providers) =>
      lastFrameDataUrl ? (await providers.llm.describeMorphMotion(firstFrameDataUrl, lastFrameDataUrl)).motionPrompt : undefined,
  });

  return { maybeStartMorph: pipeline.maybeStart };
}

/** The real app's single shared instance — routes import this. */
export const morphPipeline = createMorphPipeline();
