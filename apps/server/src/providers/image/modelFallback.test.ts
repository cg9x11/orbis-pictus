import { test } from "node:test";
import assert from "node:assert/strict";
import { withModelFallback, type ModelFallbackNotice } from "./modelFallback.js";
import { QuotaExhaustedError, UnknownModelError, type ImageGenInput, type ImageGenResult, type ImageProvider } from "../types.js";

const input: ImageGenInput = { prompt: "a felt diorama of pho", aspectRatio: "16:9" };

function ok(label: string, usedModelId?: string): ImageGenResult {
  return { bytes: Buffer.from(label), contentType: "image/png", usedModelId };
}

/** A stand-in provider whose `generate` does whatever the test needs, counting its calls. */
function fake(
  providerId: string,
  modelId: string,
  generate: () => Promise<ImageGenResult>,
): ImageProvider & { calls: number } {
  const provider = {
    providerId,
    modelId,
    calls: 0,
    async generate(): Promise<ImageGenResult> {
      provider.calls++;
      return generate();
    },
  };
  return provider;
}

test("passes a successful generation straight through, and never builds the default", async () => {
  const primary = fake("ark", "hand-typed", async () => ok("primary"));
  let defaultsBuilt = 0;
  const wrapped = withModelFallback(
    primary,
    () => {
      defaultsBuilt++;
      return fake("ark", "configured", async () => ok("default"));
    },
    () => assert.fail("onFallback must not fire on success"),
  );

  const result = await wrapped.generate(input);
  assert.equal(result.bytes.toString(), "primary");
  assert.equal(result.usedModelId, undefined, "nothing was substituted, so nothing to correct");
  assert.equal(defaultsBuilt, 0, "buildDefault must be lazy");
});

test("the wrapper advertises the REQUESTED model, so the prompt-hash cache key stays stable", () => {
  const primary = fake("ark", "hand-typed", async () => ok("primary"));
  const wrapped = withModelFallback(primary, () => fake("ark", "configured", async () => ok("d")), () => {});
  assert.equal(wrapped.modelId, "hand-typed");
  assert.equal(wrapped.providerId, "ark");
});

test("an unknown model is retried on the configured default, reported, and recorded as usedModelId", async () => {
  const primary = fake("ark", "seedream-does-not-exist", async () => {
    throw new UnknownModelError('Ark does not recognise image model "seedream-does-not-exist" (ModelNotOpen).');
  });
  const fallbackProvider = fake("ark", "seedream-4-5-251128", async () => ok("fallback"));
  const notices: ModelFallbackNotice[] = [];

  const wrapped = withModelFallback(primary, () => fallbackProvider, (n) => {
    notices.push(n);
  });
  const result = await wrapped.generate(input);

  assert.equal(result.bytes.toString(), "fallback");
  assert.equal(result.usedModelId, "seedream-4-5-251128", "the node must credit the model that drew");
  assert.equal(primary.calls, 1);
  assert.equal(fallbackProvider.calls, 1);

  assert.equal(notices.length, 1);
  assert.equal(notices[0]!.requested, "seedream-does-not-exist");
  assert.equal(notices[0]!.used, "seedream-4-5-251128");
  assert.match(notices[0]!.reason, /ModelNotOpen/);
});

test("an inner correction wins: the fallback provider's own usedModelId is preserved", async () => {
  // Ark sets usedModelId itself when its quota retry fires; that is the more specific truth.
  const primary = fake("ark", "bad", async () => {
    throw new UnknownModelError("nope");
  });
  const fallbackProvider = fake("ark", "configured", async () => ok("inner", "ark-quota-fallback-model"));

  const wrapped = withModelFallback(primary, () => fallbackProvider, () => {});
  const result = await wrapped.generate(input);
  assert.equal(result.usedModelId, "ark-quota-fallback-model");
});

test("rethrows when the configured default is the very model that was rejected", async () => {
  const primary = fake("ark", "same-model", async () => {
    throw new UnknownModelError("nope");
  });
  const fallbackProvider = fake("ark", "same-model", async () => ok("should not run"));
  let notified = false;

  const wrapped = withModelFallback(primary, () => fallbackProvider, () => {
    notified = true;
  });

  await assert.rejects(() => wrapped.generate(input), UnknownModelError);
  assert.equal(fallbackProvider.calls, 0, "must not pay for a second identical rejection");
  assert.equal(notified, false, "nothing was substituted, so there is nothing to report");
});

test("only UnknownModelError is caught - quota and generic failures propagate untouched", async () => {
  for (const thrown of [new QuotaExhaustedError("out of budget"), new Error("socket hang up")]) {
    const fallbackProvider = fake("ark", "configured", async () => ok("must not run"));
    const wrapped = withModelFallback(
      fake("ark", "requested", async () => {
        throw thrown;
      }),
      () => fallbackProvider,
      () => assert.fail("onFallback must not fire"),
    );

    await assert.rejects(() => wrapped.generate(input), (err) => err === thrown);
    assert.equal(fallbackProvider.calls, 0, "retrying these on another model would just spend budget");
  }
});
