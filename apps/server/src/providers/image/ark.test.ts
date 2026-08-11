import { test } from "node:test";
import assert from "node:assert/strict";
import { ArkImageProvider } from "./ark.js";
import { buildImageProvider } from "./index.js";
import { QuotaExhaustedError, UnknownModelError, type ImageGenInput } from "../types.js";

interface Recorded {
  url: string;
  init: RequestInit | undefined;
}

/**
 * Stubs global.fetch with a queue of canned responses - one per call, in order - recording each
 * call and restoring the original afterwards. A queue (rather than the single canned response the
 * sibling provider tests use) is what lets a two-model fallback be exercised in one run.
 *
 * Ark's quota errors arrive as 429, which `isTransientStatus` deliberately excludes from retry, so
 * each model attempt is exactly one fetch here with no backoff sleeping in between.
 */
function withFetchQueue(
  responses: { status: number; body: unknown }[],
  run: (calls: Recorded[]) => Promise<void>,
): Promise<void> {
  const calls: Recorded[] = [];
  const queue = [...responses];
  const original = globalThis.fetch;
  // @ts-expect-error -- narrow test stub
  globalThis.fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected fetch #${calls.length} to ${url}: no response queued`);
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "content-type": "application/json" },
    });
  };
  return run(calls).finally(() => {
    globalThis.fetch = original;
  });
}

const base = "https://ark.example.com";
const input: ImageGenInput = { prompt: "a felt diorama of pho", aspectRatio: "16:9" };
const okBody = { data: [{ b64_json: Buffer.from("ark-img").toString("base64") }] };
const quotaBody = { error: { code: "QuotaExceeded", message: "quota exhausted for this model" } };

function modelOf(call: Recorded): string {
  return JSON.parse(call.init!.body as string).model as string;
}

test("ark image: a successful draw reports no usedModelId, so callers record the advertised modelId", async () => {
  await withFetchQueue([{ status: 200, body: okBody }], async (calls) => {
    const provider = new ArkImageProvider("k", base, "primary-model", "fallback-model");
    const result = await provider.generate(input);

    assert.equal(result.bytes.toString(), "ark-img");
    assert.equal(result.usedModelId, undefined, "no fallback fired, so nothing to correct");
    assert.equal(calls.length, 1);
    assert.equal(modelOf(calls[0]!), "primary-model");
  });
});

test("ark image: a quota rejection falls back to the fallback model AND reports it as usedModelId", async () => {
  await withFetchQueue(
    [
      { status: 429, body: quotaBody },
      { status: 200, body: okBody },
    ],
    async (calls) => {
      const provider = new ArkImageProvider("k", base, "primary-model", "fallback-model");
      const result = await provider.generate(input);

      assert.equal(result.bytes.toString(), "ark-img");
      // The regression this guards: without usedModelId the node records "primary-model", crediting
      // a model that was rejected and never drew anything.
      assert.equal(result.usedModelId, "fallback-model");

      assert.equal(calls.length, 2);
      assert.equal(modelOf(calls[0]!), "primary-model");
      assert.equal(modelOf(calls[1]!), "fallback-model");
    },
  );
});

test("ark image: an unrecognised model throws UnknownModelError WITHOUT burning the quota fallback", async () => {
  const modelNotOpen = { error: { code: "ModelNotOpen", message: "has not activated the model" } };
  await withFetchQueue([{ status: 404, body: modelNotOpen }], async (calls) => {
    const provider = new ArkImageProvider("k", base, "seedream-does-not-exist", "fallback-model");
    await assert.rejects(() => provider.generate(input), UnknownModelError);
    // The configured fallback model exists for quota exhaustion. A bad model name is not a budget
    // problem, so retrying it here would spend a request on a remedy that cannot help; the
    // model-fallback decorator handles that case because it knows the configured default.
    assert.equal(calls.length, 1);
  });
});

test("ark image: when both models are rejected the quota error names both", async () => {
  await withFetchQueue(
    [
      { status: 429, body: quotaBody },
      { status: 429, body: quotaBody },
    ],
    async () => {
      const provider = new ArkImageProvider("k", base, "primary-model", "fallback-model");
      await assert.rejects(
        () => provider.generate(input),
        (err: unknown) => {
          assert.ok(err instanceof QuotaExhaustedError);
          assert.match(err.message, /primary-model/);
          assert.match(err.message, /fallback-model/);
          return true;
        },
      );
    },
  );
});

test("ark image: an unrecognised FALLBACK model reports as unknown-model, not as quota exhaustion", async () => {
  const modelNotOpen = { error: { code: "ModelNotOpen", message: "has not activated the model" } };
  await withFetchQueue(
    [
      { status: 429, body: quotaBody },
      { status: 404, body: modelNotOpen },
    ],
    async (calls) => {
      // The fallback id is user-settable from the settings panel, so it can name a model that does
      // not exist. Reported as QuotaExhaustedError this was doubly wrong: the message blamed a
      // budget that was not the cause, and modelFallback.ts - which catches UnknownModelError only -
      // let the page fail instead of redrawing on the server's configured model.
      const provider = new ArkImageProvider("k", base, "primary-model", "fallback-typo");
      await assert.rejects(
        () => provider.generate(input),
        (err: unknown) => {
          assert.ok(err instanceof UnknownModelError, `expected UnknownModelError, got ${(err as Error).constructor.name}`);
          assert.match(err.message, /fallback-typo/);
          return true;
        },
      );
      assert.equal(calls.length, 2);
    },
  );
});

test("ark image: with no fallback model configured, a quota rejection fails fast", async () => {
  await withFetchQueue([{ status: 429, body: quotaBody }], async (calls) => {
    const provider = new ArkImageProvider("k", base, "primary-model");
    await assert.rejects(() => provider.generate(input), QuotaExhaustedError);
    assert.equal(calls.length, 1, "must not attempt a second model when none is configured");
  });
});

// `fallbackModel` is private on the provider, so the override for it is exercised through the
// two-model behaviour above rather than asserted here; this covers the visible `modelId` wiring.
test("ark image: the factory honours the request's model override", () => {
  const previousProvider = process.env.IMAGE_PROVIDER;
  const previousKey = process.env.ARK_API_KEY;
  process.env.IMAGE_PROVIDER = "ark";
  process.env.ARK_API_KEY = "ark-key";
  try {
    assert.equal(buildImageProvider([]).modelId, "seedream-4-5-251128", "default comes from config");
    assert.equal(buildImageProvider([], { imageModel: "seedream-hand-typed" }).modelId, "seedream-hand-typed");
  } finally {
    if (previousProvider === undefined) delete process.env.IMAGE_PROVIDER;
    else process.env.IMAGE_PROVIDER = previousProvider;
    if (previousKey === undefined) delete process.env.ARK_API_KEY;
    else process.env.ARK_API_KEY = previousKey;
  }
});
