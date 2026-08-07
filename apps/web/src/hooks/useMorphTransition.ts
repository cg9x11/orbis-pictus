import { useRef, useState } from "react";
import { fetchNodeMorph } from "../lib/api";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import { useCancellableEffect } from "./useCancellableEffect";

/**
 * PLAN §3 Phase 5 page-transition morphs: a single non-blocking check (never a poll loop, never
 * awaited here) for a pre-generated clip when the user steps directly from a node to one of its
 * children. If nothing is ready, this returns null and the page the caller already rendered
 * synchronously is all that shows — the instant image swap. This hook is the mechanism that fetches
 * and plays the clip; it fires both on the first parent -> child step and on later revisits of that
 * same pair.
 *
 * First-step morphs: the clip needs both the parent and the finished child frame, so it can only be
 * generated *after* the child exists (~30s+). To make it play on the very first step, the wait is
 * handled upstream: useFlipbookController holds navigation on the parent until the morph is ready,
 * then appends the child — at which point this hook fetches the now-ready clip and plays it. That
 * hold only happens while the per-session morph cap has room (the server marks morph_status
 * "pending" only then); once the cap is hit, or Live video is off, the child arrives with a null
 * morph_status, navigation is instant, and this hook simply 404s to null (the plain swap). A morph
 * that fails or times out during the wait also lands here as a null — same instant swap.
 *
 * Deliberately does NOT fire for: the very first page in a session, jumping to an arbitrary
 * ancestor via the breadcrumb trail, or a deep-linked `/n/:id` load — only a true one-step
 * parent -> child transition, detected by comparing the incoming node's parent_id against the
 * previously-current node's id.
 */
export function useMorphTransition(
  currentId: string | undefined,
  parentId: string | null | undefined,
  enabled: boolean,
): [string | null, () => void] {
  const [morphUrl, setMorphUrl] = useState<string | null>(null);
  const previousIdRef = useRef<string | undefined>(undefined);
  const reducedMotion = usePrefersReducedMotion();

  useCancellableEffect(
    (cancelled) => {
      const previousId = previousIdRef.current;
      previousIdRef.current = currentId;

      setMorphUrl(null);
      if (!enabled || !currentId || reducedMotion) return;
      if (!parentId || parentId !== previousId) return;

      fetchNodeMorph(currentId)
        .then((url) => {
          if (!cancelled()) setMorphUrl(url);
        })
        .catch(() => {
          // Non-fatal: no morph plays, same as a 404 — the page is already showing.
        });
    },
    [currentId, parentId, enabled, reducedMotion],
  );

  return [morphUrl, () => setMorphUrl(null)];
}
