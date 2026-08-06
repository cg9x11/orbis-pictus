import type { AspectRatio, Node } from "@flipbook/shared";
import type { Providers } from "../providers/index.js";
import { getVideoInfo, markVideoFailed, markVideoPending, markVideoReady } from "../storage/nodes.js";
import { loadImageAsDataUrl } from "./imageStorage.js";
import { saveVideo } from "./videoStorage.js";
import { getVideoDurationSeconds, getVideoMaxPerSession, getVideoResolution, isVideoEnabled } from "./videoConfig.js";
import { IDLE_LOOP_MOTION_PROMPT } from "./videoPrompt.js";

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
  const inFlight = new Set<string>();
  const sessionCounts = new Map<string, number>();

  function maybeStartIdleLoop(node: Node, providers: Providers, imagesDir: string): void {
    if (!isVideoEnabled()) return;
    if (inFlight.has(node.id)) return;

    // A node that already has a stored video (or already failed once) must never regenerate one.
    const info = getVideoInfo(node.id);
    if (info?.status) return;

    const count = sessionCounts.get(node.session_id) ?? 0;
    if (count >= getVideoMaxPerSession()) return;

    const variant = pickImageVariant(node);
    if (!variant) return;

    inFlight.add(node.id);
    sessionCounts.set(node.session_id, count + 1);
    markVideoPending(node.id);

    void (async () => {
      try {
        const firstFrameDataUrl = loadImageAsDataUrl(imagesDir, variant.url);
        const { bytes } = await providers.video.generate({
          prompt: IDLE_LOOP_MOTION_PROMPT,
          aspectRatio: variant.ratio,
          firstFrameDataUrl,
          durationSeconds: getVideoDurationSeconds(),
          resolution: getVideoResolution(),
        });
        const videoUrl = saveVideo(imagesDir, node.id, bytes);
        markVideoReady(node.id, videoUrl);
      } catch (err) {
        console.error(`[flipbook] idle-loop video generation failed for node ${node.id}:`, err instanceof Error ? err.message : err);
        markVideoFailed(node.id);
      } finally {
        inFlight.delete(node.id);
      }
    })();
  }

  return { maybeStartIdleLoop };
}

/** The real app's single shared instance — routes import this. */
export const videoPipeline = createVideoPipeline();
