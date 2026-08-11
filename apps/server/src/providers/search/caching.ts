import type { SearchProvider, SearchResult } from "../types.js";

/**
 * Wraps another SearchProvider with an in-memory, process-lifetime cache keyed on the (normalized)
 * query string, so a topic searched more than once (regenerate, variant taps, edit re-renders)
 * only spends LLM/web-search quota once. Opt-in via SEARCH_CACHE_ENABLED - off by default because
 * the search model can legitimately return a different, fresher summary for the same query each
 * call, and caching trades that freshness for saved quota.
 *
 * Only genuine results are cached: a null (nothing found) or a `degraded` result (model-knowledge
 * fallback, not real web results - see search/llm.ts) is usually transient, so it is passed through
 * uncached and the next request retries a real search rather than being pinned to the bad outcome.
 * The cache is unbounded but small (one short summary per distinct query) and clears on restart.
 */
export class CachingSearchProvider implements SearchProvider {
  readonly available: boolean;
  private readonly cache = new Map<string, SearchResult>();

  constructor(private readonly inner: SearchProvider) {
    this.available = inner.available;
  }

  async search(query: string): Promise<SearchResult | null> {
    const key = query.trim().toLowerCase().replace(/\s+/g, " ");
    const cached = this.cache.get(key);
    if (cached) return cached;

    const result = await this.inner.search(query);
    if (result && !result.degraded) this.cache.set(key, result);
    return result;
  }
}
