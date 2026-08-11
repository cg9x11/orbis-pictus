import { useEffect, useState } from "react";

/** Whole seconds elapsed since `startedAt` (epoch ms), ticking every second. Returns null while
 *  `startedAt` is undefined - a variant re-render has no stream and nothing to count from. */
export function useElapsedSeconds(startedAt: number | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === undefined) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  if (startedAt === undefined) return null;
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}
