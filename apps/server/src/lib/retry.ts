/** PLAN §1.3: persistence retries — the initial attempt plus 3 retries, backed off [1s, 3s, 7s]. */
const DEFAULT_BACKOFF_MS = [1000, 3000, 7000];

export async function withRetry<T>(fn: () => T | Promise<T>, backoffMs: number[] = DEFAULT_BACKOFF_MS): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= backoffMs.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === backoffMs.length) break;
      await new Promise((resolve) => setTimeout(resolve, backoffMs[attempt]));
    }
  }
  throw lastErr;
}
