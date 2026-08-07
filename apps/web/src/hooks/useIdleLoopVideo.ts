import { useRef, useState } from "react";
import type { VideoStatus } from "@flipbook/shared";
import { fetchNodeVideo } from "../lib/api";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import { useCancellableEffect } from "./useCancellableEffect";

// Server-side generation of a 480p/5s clip took ~32s in the verified live test (PLAN §2 Video
// findings); this schedule starts checking a bit before that and backs off from there. Capped at
// ~15 attempts (a few minutes) so a stalled/failed generation is abandoned quietly rather than
// polled forever — the static image is always a fine fallback.
const BACKOFF_MS = [4000, 4000, 6000, 8000, 10000, 15000, 20000, 20000];
const MAX_ATTEMPTS = 15;

/**
 * Polls `GET /api/nodes/:id/video` with backoff while `enabled`, returning the clip URL once
 * ready (or null while pending/disabled/reduced-motion). PLAN §3 Phase 5: never gates page
 * render — this is purely additive UI state layered on top of the already-visible static image.
 *
 * `status` comes from the node payload and decides whether polling happens at all. Without it this
 * hook polled every page for ~2-3 minutes and then gave up in silence, because /video answers 404
 * both for "still generating" and for "nothing is generating" — and the second case is the common
 * one: video is off by default, so every page created before it was switched on has no clip and
 * never will. Only "pending" (a clip is genuinely on its way) and "ready" are worth a request.
 */
export function useIdleLoopVideo(
  nodeId: string | undefined,
  enabled: boolean,
  status: VideoStatus | null | undefined,
): string | null {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const lastNodeIdRef = useRef<string | undefined>(undefined);
  const reducedMotion = usePrefersReducedMotion();

  useCancellableEffect(
    (cancelled) => {
      const nodeChanged = lastNodeIdRef.current !== nodeId;
      lastNodeIdRef.current = nodeId;

      const canShow = enabled && !!nodeId && !reducedMotion && (status === "pending" || status === "ready");
      // Clear the previous clip when the page changes, or when this page can no longer show one
      // (toggled off, reduced motion, no clip). But a same-node status flip from "pending" to
      // "ready" — written back once the clip is fetched — must NOT blink the already-playing video:
      // the poll below re-fetches the same URL and setVideoUrl bails out, so nothing remounts.
      if (nodeChanged || !canShow) setVideoUrl(null);
      // Equivalent to `!canShow` but written so TypeScript narrows nodeId to a string below.
      if (!enabled || !nodeId || reducedMotion) return;
      if (status !== "pending" && status !== "ready") return;

      let timer: ReturnType<typeof setTimeout>;

      const poll = async (attempt: number) => {
        const url = await fetchNodeVideo(nodeId).catch(() => null);
        if (cancelled()) return;
        if (url) {
          setVideoUrl(url);
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
    [nodeId, enabled, reducedMotion, status],
  );

  return videoUrl;
}
