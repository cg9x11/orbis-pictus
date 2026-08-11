import { test } from "node:test";
import assert from "node:assert/strict";
import { FalImageProvider } from "./fal.js";
import { UnknownModelError, type ImageGenInput } from "../types.js";

const input: ImageGenInput = { prompt: "a felt diorama of pho", aspectRatio: "16:9" };

/** Stubs global.fetch with one canned response, recording the calls, and restores it after. */
function withFetch(
  response: { status: number; body: unknown },
  run: (calls: string[]) => Promise<void>,
): Promise<void> {
  const calls: string[] = [];
  const original = globalThis.fetch;
  // @ts-expect-error -- narrow test stub
  globalThis.fetch = async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  };
  return run(calls).finally(() => {
    globalThis.fetch = original;
  });
}

test("fal: an unknown model surfaces as UnknownModelError, so the fallback can catch it", async () => {
  // Captured verbatim from the live fal.ai API on 2026-08-08 by requesting a nonexistent model.
  // Note the wording: "Application", never "model" - matching on the word "model" would miss it,
  // which is why the 404 status is the signal here.
  await withFetch({ status: 404, body: { detail: "Application 'does-not-exist-9' not found" } }, async (calls) => {
    const provider = new FalImageProvider("k", "fal-ai/does-not-exist-9");
    await assert.rejects(() => provider.generate(input), UnknownModelError);
    // The model id is the path, which is what makes a 404 unambiguous here.
    assert.equal(calls[0], "https://fal.run/fal-ai/does-not-exist-9");
  });
});

test("fal: a non-404 failure stays a plain error", async () => {
  await withFetch({ status: 500, body: { detail: "internal" } }, async () => {
    const provider = new FalImageProvider("k", "fal-ai/flux/schnell");
    await assert.rejects(
      () => provider.generate(input),
      (err: unknown) => err instanceof Error && !(err instanceof UnknownModelError),
    );
  });
});
