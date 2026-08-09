import { useEffect, useRef, type RefObject } from "react";

/**
 * Closes a popover on the Escape key, and — when `ref` is given — on a pointer press outside it.
 * Only active while `open` is true.
 *
 * `onClose` is read through a ref, so a caller never has to memoize it. The effect depends only on
 * `open` (and the stable `ref`), so a parent re-render that hands in a fresh `onClose` does not tear
 * down and re-add the document listeners mid-interaction — which would otherwise pull focus or drop
 * an in-flight press. This is the same ref-indirection the panels used inline before.
 *
 * Pass `ref` for a self-contained popover that should close when the user clicks away. Omit it for a
 * panel that already has its own backdrop to catch outside clicks and only needs Escape.
 */
export function useDismiss(open: boolean, onClose: () => void, ref?: RefObject<HTMLElement>): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!ref!.current?.contains(e.target as Node)) onCloseRef.current();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    if (ref) document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      if (ref) document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, ref]);
}
