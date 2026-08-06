import { useEffect, useState } from "react";
import type { AspectRatio, CachedTap } from "@flipbook/shared";
import { fetchNodeTaps } from "../lib/api";

/**
 * The already-explored tap points for the current page (PLAN §2.3 layer 2). Refetched whenever the
 * page or the aspect ratio changes — the tap cache is keyed on both, since marker geometry differs
 * per ratio. That covers staleness on its own: a tap creates its child and immediately navigates
 * into it, so the parent's markers are re-read the moment the user comes back to it.
 */
export function useCachedTaps(nodeId: string | undefined, aspectRatio: AspectRatio): CachedTap[] {
  const [taps, setTaps] = useState<CachedTap[]>([]);

  useEffect(() => {
    setTaps([]);
    if (!nodeId) return;

    let cancelled = false;
    fetchNodeTaps(nodeId, aspectRatio)
      .then((next) => {
        if (!cancelled) setTaps(next);
      })
      .catch(() => {
        // Non-fatal: no markers is exactly the pre-existing behaviour, and tapping still works.
      });
    return () => {
      cancelled = true;
    };
  }, [nodeId, aspectRatio]);

  return taps;
}
