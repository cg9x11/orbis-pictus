import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateImageCost, IMAGE_MODEL_RATES } from "./pricing.js";

test("estimateImageCost computes input+output cost from token usage and the model's rates", () => {
  // gemini-3.1-flash-lite-image: in $0.25/M, out $30/M. A 1K image ≈ 1120 output tokens.
  const est = estimateImageCost("gemini-3.1-flash-lite-image", { inputTokens: 12, outputTokens: 1120, totalTokens: 1132 });
  assert.ok(est);
  const expected = (12 / 1e6) * 0.25 + (1120 / 1e6) * 30;
  assert.ok(Math.abs(est!.usd - expected) < 1e-9, `got ${est!.usd}, expected ${expected}`);
  // Output dominates and lands near the published ~$0.034/1K image.
  assert.ok(est!.usd > 0.033 && est!.usd < 0.035);
});

test("estimateImageCost returns null for an unknown model", () => {
  assert.equal(estimateImageCost("some-unlisted-model", { outputTokens: 1000 }), null);
});

test("estimateImageCost returns null when usage is missing", () => {
  assert.equal(estimateImageCost("gpt-image-1.5", undefined), null);
});

test("estimateImageCost treats missing token fields as zero", () => {
  const est = estimateImageCost("gpt-image-1.5", { outputTokens: 1000 }); // no inputTokens
  assert.ok(est);
  assert.ok(Math.abs(est!.usd - (1000 / 1e6) * 32) < 1e-9);
});

test("every rate entry has positive input and output rates", () => {
  for (const [model, rate] of Object.entries(IMAGE_MODEL_RATES)) {
    assert.ok(rate.inputPerM > 0, `${model} inputPerM`);
    assert.ok(rate.outputPerM > 0, `${model} outputPerM`);
  }
});
