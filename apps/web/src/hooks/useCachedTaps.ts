import { useState } from "react";
import type { AspectRatio, CachedTap, TapDedupMode } from "@orbis/shared";
import { fetchNodeTaps } from "../lib/api";
import { useCancellableEffect } from "./useCancellableEffect";

export interface CachedTapsState {
  taps: CachedTap[];
  /**
   * The server's dedup mode. "off" until the first response lands — but callers must NOT read that
   * as "no dedup here". Use `loading` for that: an unanswered fetch is unknown, not off, and the
   * two failure directions are not equal. Treating unknown as off skips the explored-spot check and
   * spends money; treating it as unknown only delays a tap.
   */
  mode: TapDedupMode;
  /** True until the first response (or failure) for the current node and ratio. */
  loading: boolean;
}

const EMPTY: CachedTapsState = { taps: [], mode: "off", loading: false };

/**
 * The already-explored tap points for the current page. Refetched whenever the
 * page or the aspect ratio changes — the tap cache is keyed on both, since marker geometry differs
 * per ratio. That covers staleness on its own: a tap creates its child and immediately navigates
 * into it, so the parent's markers are re-read the moment the user comes back to it.
 */
export function useCachedTaps(nodeId: string | undefined, aspectRatio: AspectRatio): CachedTapsState {
  const [state, setState] = useState<CachedTapsState>(EMPTY);

  useCancellableEffect(
    (cancelled) => {
      if (!nodeId) {
        setState(EMPTY);
        return;
      }
      setState({ ...EMPTY, loading: true });

      fetchNodeTaps(nodeId, aspectRatio)
        .then((next) => {
          if (!cancelled()) setState({ taps: next.taps, mode: next.mode, loading: false });
        })
        .catch(() => {
          // Non-fatal: no markers is the pre-existing behaviour, and tapping still works. Clearing
          // `loading` deliberately unblocks taps — a page whose markers cannot be fetched must stay
          // usable, and the server re-checks its own cache on every generate anyway.
          if (!cancelled()) setState(EMPTY);
        });
    },
    [nodeId, aspectRatio],
  );

  return state;
}
