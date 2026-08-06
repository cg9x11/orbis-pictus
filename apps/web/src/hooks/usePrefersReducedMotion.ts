import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/** PLAN §3 Phase 5: idle-loop video must never autoplay for users who prefer reduced motion. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia?.(QUERY).matches ?? false);

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const handler = () => setReduced(mql.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return reduced;
}
