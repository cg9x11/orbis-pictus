import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchWithRetry, isTransientStatus } from "./retry.js";

/** Stubs global.fetch with a canned sequence of responses/errors, and restores it after. */
function withFetchSequence(steps: (number | Error)[], run: () => Promise<void>): Promise<void> {
  let index = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    const step = steps[index];
    index++;
    if (step === undefined) throw new Error("Unexpected extra fetch call");
    if (step instanceof Error) throw step;
    return new Response(null, { status: step });
  };
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

test("isTransientStatus treats 5xx and 408 as transient", () => {
  assert.equal(isTransientStatus(500), true);
  assert.equal(isTransientStatus(503), true);
  assert.equal(isTransientStatus(408), true);
});

test("isTransientStatus deliberately excludes 429 - a caller whose 429 means quota/rate-limit needs it to surface immediately, not vanish into blind retry", () => {
  assert.equal(isTransientStatus(429), false);
});

test("isTransientStatus treats other 4xx and 2xx as terminal", () => {
  assert.equal(isTransientStatus(400), false);
  assert.equal(isTransientStatus(401), false);
  assert.equal(isTransientStatus(404), false);
  assert.equal(isTransientStatus(200), false);
});

test("fetchWithRetry returns a successful response immediately, without retrying", async () => {
  await withFetchSequence([200], async () => {
    const res = await fetchWithRetry("http://x", {}, [5, 5]);
    assert.equal(res.status, 200);
  });
});

test("fetchWithRetry retries a transient 503 and returns the eventual success", async () => {
  await withFetchSequence([503, 503, 200], async () => {
    const res = await fetchWithRetry("http://x", {}, [5, 5]);
    assert.equal(res.status, 200);
  });
});

test("fetchWithRetry does not retry a non-transient 400 - returns it on the first attempt", async () => {
  let fetchCount = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCount++;
    return new Response(null, { status: 400 });
  };
  try {
    const res = await fetchWithRetry("http://x", {}, [5, 5]);
    assert.equal(res.status, 400);
    assert.equal(fetchCount, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("fetchWithRetry retries a thrown network error and returns the eventual success", async () => {
  await withFetchSequence([new TypeError("fetch failed"), 200], async () => {
    const res = await fetchWithRetry("http://x", {}, [5, 5]);
    assert.equal(res.status, 200);
  });
});

test("fetchWithRetry exhausts its backoff and returns the last transient response instead of retrying forever", async () => {
  await withFetchSequence([503, 503, 503], async () => {
    const res = await fetchWithRetry("http://x", {}, [5, 5]);
    assert.equal(res.status, 503);
  });
});

test("fetchWithRetry exhausts its backoff and rethrows the last network error", async () => {
  await withFetchSequence([new TypeError("fetch failed"), new TypeError("fetch failed"), new TypeError("fetch failed")], async () => {
    await assert.rejects(() => fetchWithRetry("http://x", {}, [5, 5]), /fetch failed/);
  });
});
