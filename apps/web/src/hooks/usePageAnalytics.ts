import { useCallback, useState } from "react";

const STORAGE_KEY = "orbis_pages_generated:v1";
const MILESTONES = [5, 10, 25, 50, 100, 250];

function readCount(): number {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Page-generated counter + milestone tracking, sessionStorage only, no external service. */
export function usePageAnalytics() {
  const [count, setCount] = useState(readCount);
  const [milestone, setMilestone] = useState<number | null>(null);

  const recordPage = useCallback(() => {
    setCount((prev) => {
      const next = prev + 1;
      try {
        sessionStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // Storage may be unavailable (e.g. private browsing); the in-memory count still works.
      }
      if (MILESTONES.includes(next)) setMilestone(next);
      return next;
    });
  }, []);

  const dismissMilestone = useCallback(() => setMilestone(null), []);

  // `count` stays as internal state (it drives the milestone check) but is not returned - no consumer
  // reads it, and exposing it invites a stale second source of the page total.
  return { milestone, recordPage, dismissMilestone };
}
