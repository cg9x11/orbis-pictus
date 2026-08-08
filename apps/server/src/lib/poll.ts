/** Backoff schedule for polling an async task; last value repeats once exhausted. Tuned against
 *  the real Ark video API: a 480p/5s clip took ~32s end-to-end. */
const DEFAULT_INTERVALS_MS = [2000, 3000, 5000, 5000, 8000, 8000, 10000];
const DEFAULT_MAX_ATTEMPTS = 40; // ~ up to several minutes with the schedule above capped at its last value

export interface PollOutcome<T> {
  done: boolean;
  failed?: boolean;
  errorMessage?: string;
  value?: T;
}

export interface PollOptions {
  intervalsMs?: number[];
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Polls `check` with backoff until it reports done/failed, or throws once `maxAttempts` is exhausted — never hangs. */
export async function pollUntilDone<T>(check: () => Promise<PollOutcome<T>>, opts: PollOptions = {}): Promise<T> {
  const intervals = opts.intervalsMs ?? DEFAULT_INTERVALS_MS;
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const outcome = await check();
    if (outcome.failed) throw new Error(outcome.errorMessage ?? "Task failed");
    if (outcome.done) return outcome.value as T;
    await sleep(intervals[Math.min(attempt, intervals.length - 1)]!);
  }
  throw new Error("Polling timed out waiting for task to finish");
}
