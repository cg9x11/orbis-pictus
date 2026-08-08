import { useState } from "react";
import type { VideoStatus } from "@orbis/shared";
import { fetchNodeVideo } from "../lib/api";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import { useCancellableEffect } from "./useCancellableEffect";

// Server-side generation of a 480p/5s clip took ~32s in the verified live test; this schedule
// starts checking a bit before that and backs off from there. Capped at
// ~15 attempts (a few minutes) so a stalled/failed generation is abandoned quietly rather than
// polled forever — the static image is always a fine fallback.
const BACKOFF_MS = [4000, 4000, 6000, 8000, 10000, 15000, 20000, 20000];
const MAX_ATTEMPTS = 15;

/**
 * Polls `GET /api/nodes/:id/video` with backoff while `enabled`, returning the clip URL once
 * ready (or null while pending/disabled/reduced-motion). Never gates page
 * render — this is purely additive UI state layered on top of the already-visible static image.
 *
 * `status` comes from the node payload and decides whether polling happens at all. Without it this
 * hook polled every page for ~2-3 minutes and then gave up in silence, because /video answers 404
 * both for "still generating" and for "nothing is generating" — and the second case is the common
 * one: video is off by default, so every page created before it was switched on has no clip and
 * never will. Only "pending" (a clip is genuinely on its way) and "ready" are worth a request.
 *
 * The fetched clip is stored together with the node it belongs to, and read back only while that
 * node is still the current one. Holding a bare URL in state instead let one page's clip survive
 * into the next: clearing it happened in an effect, so for the render right after navigating,
 * `current` was already the new node while this hook still returned the previous node's URL. That
 * window was enough for useOrbisController's "write ready back to the trail" effect — which runs
 * in the same commit — to stamp video_status "ready" onto a node with no clip at all, which then
 * hid its "Generate video" button for good and left it polling a 404. Deriving the answer during
 * render closes the window entirely; it also stops the old clip painting over the new page's image.
 */
export function useIdleLoopVideo(
  nodeId: string | undefined,
  enabled: boolean,
  status: VideoStatus | null | undefined,
): string | null {
  const [fetched, setFetched] = useState<{ nodeId: string; url: string } | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  const canShow = enabled && !!nodeId && !reducedMotion && (status === "pending" || status === "ready");

  useCancellableEffect(
    (cancelled) => {
      // `canShow` covers enabled/reduced-motion/status; the extra nodeId check narrows it to string.
      if (!canShow || !nodeId) return;

      let timer: ReturnType<typeof setTimeout>;

      const poll = async (attempt: number) => {
        const url = await fetchNodeVideo(nodeId).catch(() => null);
        if (cancelled()) return;
        if (url) {
          setFetched({ nodeId, url });
          return;
        }
        if (attempt >= MAX_ATTEMPTS) return;
        const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!;
        timer = setTimeout(() => poll(attempt + 1), delay);
      };

      // An already-ready clip needs no waiting period — fetch it straight away.
      timer = setTimeout(() => poll(0), status === "ready" ? 0 : BACKOFF_MS[0]);
      return () => clearTimeout(timer);
    },
    [nodeId, canShow, status],
  );

  // A same-node status flip from "pending" to "ready" (written back once the clip is fetched) keeps
  // both `canShow` and the stored nodeId true, so the playing video is never remounted mid-loop.
  return canShow && fetched?.nodeId === nodeId ? fetched.url : null;
}
