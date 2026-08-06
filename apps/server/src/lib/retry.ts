/** Retry backoff: the initial attempt plus 3 retries, backed off [1s, 3s, 7s]. Originally sized
 *  for DB persistence (PLAN §1.3) but reused as-is for outbound provider HTTP calls below. */
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

/** HTTP statuses worth blindly retrying: server errors and request timeout are momentary and
 *  likely to succeed on retry. 429 is deliberately NOT included here even though it's also
 *  "transient" in the general sense — a provider whose 429 means "quota/rate limit" (see
 *  providers/ark/errors.ts's isQuotaOrRateError) needs that to surface immediately so its own
 *  fallback/fail-fast logic can react, not disappear into up to ~11s of blind retry first. A
 *  caller that knows its own 429 is safe to retry (e.g. a lightweight status poll) can still treat
 *  it as transient itself — see providers/video/ark.ts's checkTask. */
export function isTransientStatus(status: number): boolean {
  return status >= 500 || status === 408;
}

/**
 * fetch() with the same retry/backoff shape as withRetry, but only for what's actually worth
 * retrying: the fetch call itself throwing (a network error — DNS failure, connection reset, etc)
 * or a transient HTTP status (isTransientStatus). A definite response — 2xx, or a non-transient
 * 4xx — is returned immediately on the first attempt; the caller's own `!res.ok` handling decides
 * what to do with it, exactly as if this were a plain fetch(). Used by every provider that talks
 * to an external API over HTTP, so one network blip doesn't fail the whole page.
 */
export async function fetchWithRetry(url: string, init: RequestInit, backoffMs: number[] = DEFAULT_BACKOFF_MS): Promise<Response> {
  let attempt = 0;
  while (true) {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      if (attempt >= backoffMs.length) throw err;
      await new Promise((resolve) => setTimeout(resolve, backoffMs[attempt]));
      attempt++;
      continue;
    }
    if (res.ok || !isTransientStatus(res.status) || attempt >= backoffMs.length) return res;
    await new Promise((resolve) => setTimeout(resolve, backoffMs[attempt]));
    attempt++;
  }
}
