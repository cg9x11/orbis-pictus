import type { SearchProvider, SearchResult } from "../types.js";

/** Stub: web search is off in Phase 1 regardless of the `web_search` request flag. */
export class NoneSearchProvider implements SearchProvider {
  readonly available = false;

  async search(_query: string): Promise<SearchResult | null> {
    return null;
  }
}
