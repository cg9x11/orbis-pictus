import { useEffect, useState } from "react";

/**
 * Mirrors `active`, but only turns true after it's stayed true for `delayMs`. Used so a
 * near-instant generation (a tap-cache/dedup hit) never flashes a loading state
 * that would otherwise mount and unmount within a single frame.
 */
export function useDelayedFlag(active: boolean, delayMs = 150): boolean {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);

  return shown;
}
