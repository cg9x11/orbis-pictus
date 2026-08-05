import { useCallback, useState } from "react";

const STORAGE_KEY = "flipbook_pages_generated";
const MILESTONES = [5, 10, 25, 50, 100, 250];

function readCount(): number {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** PLAN §1.4/§3: page-generated counter + milestone tracking, sessionStorage only, no external service. */
export function usePageAnalytics() {
  const [count, setCount] = useState(readCount);
  const [milestone, setMilestone] = useState<number | null>(null);

  const recordPage = useCallback(() => {
    setCount((prev) => {
      const next = prev + 1;
      sessionStorage.setItem(STORAGE_KEY, String(next));
      if (MILESTONES.includes(next)) setMilestone(next);
      return next;
    });
  }, []);

  const dismissMilestone = useCallback(() => setMilestone(null), []);

  return { count, milestone, recordPage, dismissMilestone };
}
