import type { AspectRatio, Node } from "@flipbook/shared";
import type { Providers } from "../providers/index.js";
import { getVideoInfo, markVideoFailed, markVideoPending, markVideoReady } from "../storage/nodes.js";
import { saveVideo } from "./videoStorage.js";
import { getVideoMaxPerSession, isVideoEnabled } from "./videoConfig.js";
import { IDLE_LOOP_MOTION_PROMPT } from "./videoPrompt.js";
import { createBackgroundClipPipeline } from "./backgroundClip.js";

const RATIO_PREFERENCE: AspectRatio[] = ["16:9", "3:4", "1:1"];

function pickImageVariant(node: Node): { ratio: AspectRatio; url: string } | null {
  for (const ratio of RATIO_PREFERENCE) {
    const url = node.image_variants[ratio];
    if (url) return { ratio, url };
  }
  return null;
}

export interface VideoPipeline {
  /**
   * Fire-and-forget: kicks off background idle-loop generation for `node` if the feature is on
   * and every guard passes (PLAN §3 Phase 5). Never awaited by callers — a page must never wait
   * on video. Safe to call for every completed page unconditionally; all gating happens inside.
   */
  maybeStartIdleLoop(node: Node, providers: Providers, imagesDir: string): void;
}

/** Factory (not a bare singleton) so tests can get isolated in-flight/session-cap state — see video.test.ts. */
export function createVideoPipeline(): VideoPipeline {
  const pipeline = createBackgroundClipPipeline({
    label: "idle-loop video generation",
    isEnabled: isVideoEnabled,
    maxPerSession: getVideoMaxPerSession,
    getStatus: getVideoInfo,
    buildRequest: (node) => {
      const variant = pickImageVariant(node);
      if (!variant) return null;
      return {
        prompt: IDLE_LOOP_MOTION_PROMPT,
        aspectRatio: variant.ratio,
        firstFrameUrl: variant.url,
      };
    },
    markPending: markVideoPending,
    markReady: markVideoReady,
    markFailed: markVideoFailed,
    save: saveVideo,
  });

  return { maybeStartIdleLoop: pipeline.maybeStart };
}

/** The real app's single shared instance — routes import this. */
export const videoPipeline = createVideoPipeline();
