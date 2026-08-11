import { useEffect, type DependencyList } from "react";

/**
 * Runs `effect` whenever `deps` change, passing it a `cancelled()` check so async work started
 * before the next dep change (or unmount) can skip its own setState instead of updating a
 * component that has moved on - the standard `let cancelled = false` pattern, without repeating
 * the boilerplate at every call site. `effect` may return its own cleanup function (e.g. to clear
 * a timer), same as a plain `useEffect` callback would.
 */
export function useCancellableEffect(
  effect: (cancelled: () => boolean) => void | (() => void),
  deps: DependencyList,
): void {
  useEffect(() => {
    let cancelled = false;
    const cleanup = effect(() => cancelled);
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, deps);
}
