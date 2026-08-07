import { test } from "node:test";
import assert from "node:assert/strict";
import { CachingSearchProvider } from "./caching.js";
import type { SearchProvider, SearchResult } from "../types.js";

/** A SearchProvider whose responses are scripted per call, recording every query it receives. */
function scripted(available: boolean, responses: (SearchResult | null)[]): SearchProvider & { calls: string[] } {
  let i = 0;
  return {
    available,
    calls: [] as string[],
    async search(query: string): Promise<SearchResult | null> {
      this.calls.push(query);
      const next = responses[i];
      i++;
      return next ?? null;
    },
  };
}

test("caches a genuine result: a second identical query does not re-hit the inner provider", async () => {
  const inner = scripted(true, [{ summary: "first" }, { summary: "second" }]);
  const provider = new CachingSearchProvider(inner);

  const a = await provider.search("Ha Noi street food");
  const b = await provider.search("Ha Noi street food");

  assert.deepEqual(a, { summary: "first" });
  assert.deepEqual(b, { summary: "first" }); // served from cache, not the inner's "second"
  assert.equal(inner.calls.length, 1);
});

test("cache key is normalized: whitespace and case differences collapse to one entry", async () => {
  const inner = scripted(true, [{ summary: "only" }, { summary: "should-not-be-used" }]);
  const provider = new CachingSearchProvider(inner);

  await provider.search("Lighthouse Lenses");
  const b = await provider.search("  lighthouse   lenses ");

  assert.deepEqual(b, { summary: "only" });
  assert.equal(inner.calls.length, 1);
});

test("does NOT cache a degraded result: the next query retries a real search", async () => {
  const inner = scripted(true, [{ summary: "model-knowledge only", degraded: true }, { summary: "real results" }]);
  const provider = new CachingSearchProvider(inner);

  const a = await provider.search("current ticket price");
  const b = await provider.search("current ticket price");

  assert.equal(a?.degraded, true);
  assert.deepEqual(b, { summary: "real results" }); // retried, not the pinned degraded result
  assert.equal(inner.calls.length, 2);
});

test("does NOT cache a null (nothing-found) result", async () => {
  const inner = scripted(true, [null, { summary: "found on retry" }]);
  const provider = new CachingSearchProvider(inner);

  assert.equal(await provider.search("obscure topic"), null);
  assert.deepEqual(await provider.search("obscure topic"), { summary: "found on retry" });
  assert.equal(inner.calls.length, 2);
});

test("forwards the inner provider's `available` flag", () => {
  assert.equal(new CachingSearchProvider(scripted(false, [])).available, false);
  assert.equal(new CachingSearchProvider(scripted(true, [])).available, true);
});
