import type { AspectRatio, Node } from "@flipbook/shared";
import type { Providers } from "../providers/index.js";
import { getMorphInfo, getNode, markMorphFailed, markMorphPending, markMorphReady } from "../storage/nodes.js";
import { loadImageAsDataUrl } from "./imageStorage.js";
import { saveMorph } from "./morphStorage.js";
import { getVideoDurationSeconds, getVideoResolution } from "./videoConfig.js";
import { getMorphMaxPerSession, isMorphEnabled } from "./morphConfig.js";
import { MORPH_TRANSITION_MOTION_PROMPT } from "./videoPrompt.js";

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
  const inFlight = new Set<string>();
  const sessionCounts = new Map<string, number>();

  function maybeStartMorph(child: Node, providers: Providers, imagesDir: string): void {
    if (!isMorphEnabled()) return;
    if (!child.parent_id) return; // only a tap/edit child has a parent to morph from
    if (inFlight.has(child.id)) return;

    // A child that already has a stored morph (or already failed once) must never regenerate one.
    const info = getMorphInfo(child.id);
    if (info?.status) return;

    const count = sessionCounts.get(child.session_id) ?? 0;
    if (count >= getMorphMaxPerSession()) return;

    const parent = getNode(child.parent_id);
    if (!parent) return;

    const ratio = pickSharedRatio(parent, child);
    if (!ratio) return; // no image both nodes share the same aspect ratio for — skip rather than generate one

    inFlight.add(child.id);
    sessionCounts.set(child.session_id, count + 1);
    markMorphPending(child.id);

    void (async () => {
      try {
        const firstFrameDataUrl = loadImageAsDataUrl(imagesDir, parent.image_variants[ratio]!);
        const lastFrameDataUrl = loadImageAsDataUrl(imagesDir, child.image_variants[ratio]!);
        const { bytes } = await providers.video.generate({
          prompt: MORPH_TRANSITION_MOTION_PROMPT,
          aspectRatio: ratio,
          firstFrameDataUrl,
          lastFrameDataUrl,
          durationSeconds: getVideoDurationSeconds(),
          resolution: getVideoResolution(),
        });
        const morphUrl = saveMorph(imagesDir, child.id, bytes);
        markMorphReady(child.id, morphUrl);
      } catch (err) {
        console.error(`[flipbook] morph generation failed for node ${child.id}:`, err instanceof Error ? err.message : err);
        markMorphFailed(child.id);
      } finally {
        inFlight.delete(child.id);
      }
    })();
  }

  return { maybeStartMorph };
}

/** The real app's single shared instance — routes import this. */
export const morphPipeline = createMorphPipeline();
