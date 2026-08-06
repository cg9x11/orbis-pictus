import { useRef, useState } from "react";
import { fetchNodeMorph } from "../lib/api";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import { useCancellableEffect } from "./useCancellableEffect";

/**
 * PLAN §3 Phase 5 page-transition morphs: a single non-blocking check (never a poll loop, never
 * awaited by navigation) for a pre-generated clip when the user steps directly from a node to one
 * of its children. If nothing is ready yet, this returns null and the page the caller already
 * rendered synchronously is all that shows — the existing instant image swap. A morph only ever
 * plays on a later revisit of the same parent -> child pair, once an earlier visit's background
 * generation (pipeline/morph.ts) has had time to finish.
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
