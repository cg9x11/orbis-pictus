import { useRef, useState } from "react";
import type { Node } from "@orbis/shared";
import { fetchNodeMorph } from "../lib/api";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import { useCancellableEffect } from "./useCancellableEffect";

/**
 * Page-transition morphs: a single non-blocking check (never a poll loop, never
 * awaited here) for a pre-generated clip when the user moves exactly one step along the trail. If
 * nothing is ready, this returns null and the page the caller already rendered synchronously is all
 * that shows - PageImage's crossfade then covers the change.
 *
 * A morph is a first-frame/last-frame interpolation from a parent's image to its child's, so one
 * clip serves both directions of the same step:
 *  - stepping down into a child plays that child's clip forward;
 *  - stepping back up to the parent plays the same child's clip in reverse (a separate re-encode
 *    written by the server, since browsers cannot play a video backwards - negative playbackRate is
 *    in the spec but implemented nowhere).
 * Either way the clip ends on the page that is now current.
 *
 * Deliberately does NOT fire for a jump of more than one step (a breadcrumb jump to some distant
 * ancestor), the first page of a session, or a deep-linked `/n/:id` load. A multi-step jump spans
 * several parent/child pairs, so no single clip could ever represent it; those get the crossfade.
 *
 * First-step morphs: the clip needs both frames, so it can only be generated after the child exists
 * (~30s+). To make it play on the very first step, the wait is handled upstream - useOrbisController
 * holds the transition until the clips are ready, then appends the child. That hold only happens
 * while the per-session morph cap has room; once the cap is hit, or Live video is off, the child
 * arrives with a null morph_status, the transition is instant, and this hook simply 404s to null.
 */
export interface MorphTransition {
  /** The clip to play over the transition, once fetched. */
  morphUrl: string | null;
  /**
   * A one-step move was detected and its clip is being looked up. Distinct from `morphUrl === null`,
   * which on its own cannot tell "there is no morph" from "a morph is on its way" - and the caller
   * must know, because the destination image has to stay hidden until the clip is on screen. Without
   * this the new page painted for a frame, then the morph faded in starting from the OLD image, so
   * the transition visibly jumped forward and then back again.
   */
  morphPending: boolean;
  clearMorph: () => void;
}

export function useMorphTransition(current: Node | undefined, enabled: boolean): MorphTransition {
  const [morphUrl, setMorphUrl] = useState<string | null>(null);
  const [morphPending, setMorphPending] = useState(false);
  const previousRef = useRef<Node | undefined>(undefined);
  const reducedMotion = usePrefersReducedMotion();

  useCancellableEffect(
    (cancelled) => {
      const previous = previousRef.current;
      previousRef.current = current;

      setMorphUrl(null);
      setMorphPending(false);
      if (!enabled || !current || !previous || reducedMotion) return;

      // Exactly one step, in either direction - anything else has no clip and never could. A tap
      // child links to its parent via parent_id; an edit VERSION (peer model) links to the version it
      // was edited from via edited_from_id - and a root edit has a null parent_id, so both links are
      // checked. The morph clip is stored on the CHILD of the pair either way (see below).
      const forward = current.parent_id === previous.id || current.edited_from_id === previous.id;
      const back = previous.parent_id === current.id || previous.edited_from_id === current.id;
      if (!forward && !back) return;

      setMorphPending(true);
      // Both directions are stored against the CHILD of the pair, which is the node whose creation
      // generated the clip: the one we are entering going forward, the one we are leaving going back.
      fetchNodeMorph(forward ? current.id : previous.id)
        .then((clip) => {
          if (cancelled()) return;
          // reverseUrl is null when ffmpeg is unavailable or lost the race with this navigation.
          const url = clip ? (forward ? clip.url : clip.reverseUrl) : null;
          if (url) setMorphUrl(url);
          setMorphPending(false);
        })
        .catch(() => {
          // Non-fatal: no morph plays, same as a 404 - the page is already showing.
          if (!cancelled()) setMorphPending(false);
        });
    },
    [current?.id, current?.parent_id, current?.edited_from_id, enabled, reducedMotion],
  );

  return {
    morphUrl,
    morphPending,
    clearMorph: () => setMorphUrl(null),
  };
}
