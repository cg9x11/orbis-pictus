import { useEffect, useState } from "react";
import { fetchNodeVideo } from "../lib/api";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

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
 */
export function useIdleLoopVideo(nodeId: string | undefined, enabled: boolean): string | null {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    setVideoUrl(null);
    if (!enabled || !nodeId || reducedMotion) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async (attempt: number) => {
      const url = await fetchNodeVideo(nodeId).catch(() => null);
      if (cancelled) return;
      if (url) {
        setVideoUrl(url);
        return;
      }
      if (attempt >= MAX_ATTEMPTS) return;
      const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!;
      timer = setTimeout(() => poll(attempt + 1), delay);
    };

    timer = setTimeout(() => poll(0), BACKOFF_MS[0]);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [nodeId, enabled, reducedMotion]);

  return videoUrl;
}
