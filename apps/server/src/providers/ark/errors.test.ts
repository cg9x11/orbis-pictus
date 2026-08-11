import { test } from "node:test";
import assert from "node:assert/strict";
import { ArkRequestError } from "./errors.js";

const err = (status: number, code: string | undefined, message: string) => new ArkRequestError(status, code, message);

test("isUnknownModelError: recognises the observed ModelNotOpen rejection", () => {
  // Captured from a real Ark response - see providers/video/ark.test.ts.
  assert.equal(err(404, "ModelNotOpen", "has not activated the model").isUnknownModelError, true);
});

test("isUnknownModelError: recognises the live InvalidEndpointOrModel.NotFound rejection", () => {
  // Captured verbatim from the live Ark image API on 2026-08-08 by requesting a nonexistent model.
  const live = err(
    404,
    "InvalidEndpointOrModel.NotFound",
    "The model or endpoint seedream-does-not-exist-9-9 does not exist or you do not have access to it. Request id: 0217861957281209",
  );
  assert.equal(live.isUnknownModelError, true);
  assert.equal(live.isQuotaOrRateError, false);
});

test("isUnknownModelError: does NOT fire for TaskNotFound, which is also a 404", () => {
  // The regression this guards: Ark reuses 404 for an expired *video task* poll, which has nothing
  // to do with the model. Classifying on status alone would reroute it into a model fallback.
  const taskNotFound = err(404, "TaskNotFound", "no such task");
  assert.equal(taskNotFound.isUnknownModelError, false);
  assert.equal(taskNotFound.isQuotaOrRateError, false);
});

test("isUnknownModelError: does not fire for quota rejections, and vice versa", () => {
  const quota = err(429, "QuotaExceeded", "quota exhausted for this model");
  assert.equal(quota.isQuotaOrRateError, true);
  // Note this message contains the word "model" but is a budget problem; the two must not overlap,
  // because the image provider checks unknown-model FIRST and would otherwise skip its quota retry.
  assert.equal(quota.isUnknownModelError, false);

  const unknown = err(404, "ModelNotOpen", "has not activated the model");
  assert.equal(unknown.isQuotaOrRateError, false);
});

test("isUnknownModelError: matches other plausible wordings on either side of the word 'model'", () => {
  assert.equal(err(400, "InvalidParameter", "the model does not exist").isUnknownModelError, true);
  assert.equal(err(400, undefined, "invalid model specified").isUnknownModelError, true);
  assert.equal(err(404, undefined, "model not found").isUnknownModelError, true);
});

test("isUnknownModelError: stays quiet for unrelated failures", () => {
  assert.equal(err(500, undefined, "internal server error").isUnknownModelError, false);
  assert.equal(err(400, "InvalidParameter", "size must be at least 3686400 pixels").isUnknownModelError, false);
  assert.equal(err(401, "Unauthorized", "invalid api key").isUnknownModelError, false);
});
