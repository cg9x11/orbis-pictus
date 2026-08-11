import { test } from "node:test";
import assert from "node:assert/strict";
import { buildImageProvider } from "./index.js";

const KEYS = ["IMAGE_PROVIDER", "FAL_KEY", "ARK_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY"];
function reset(): void {
  for (const k of KEYS) delete process.env[k];
}

test("selects the provider named by IMAGE_PROVIDER when its key is present", () => {
  reset();
  process.env.IMAGE_PROVIDER = "gemini";
  process.env.GEMINI_API_KEY = "g-key";
  const missing: string[] = [];
  assert.equal(buildImageProvider(missing).providerId, "gemini");
  assert.equal(missing.length, 0);

  process.env.IMAGE_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "o-key";
  assert.equal(buildImageProvider([]).providerId, "openai");

  process.env.IMAGE_PROVIDER = "fal";
  process.env.FAL_KEY = "f-key";
  assert.equal(buildImageProvider([]).providerId, "fal");
  reset();
});

test("falls back to mock (and reports the missing key) when the selected provider has no key", () => {
  reset();
  process.env.IMAGE_PROVIDER = "openai"; // no OPENAI_API_KEY
  const missing: string[] = [];
  assert.equal(buildImageProvider(missing).providerId, "mock");
  assert.ok(
    missing.some((m) => m.includes("OPENAI_API_KEY")),
    "should report the missing OpenAI key",
  );
  reset();
});

test("an unknown IMAGE_PROVIDER name falls back to mock and is reported", () => {
  reset();
  process.env.IMAGE_PROVIDER = "not-a-provider";
  const missing: string[] = [];
  assert.equal(buildImageProvider(missing).providerId, "mock");
  assert.ok(missing.some((m) => m.includes("not-a-provider")));
  reset();
});

test("IMAGE_PROVIDER=mock is respected explicitly", () => {
  reset();
  process.env.IMAGE_PROVIDER = "mock";
  assert.equal(buildImageProvider([]).providerId, "mock");
  reset();
});

// --- Per-request overrides (the UI picker) ---
// The override path deliberately fails differently from the configured path above: it degrades to
// the *configured* provider, never the mock, because mock art looks like a broken generation
// rather than a misconfiguration.

test("an override selects a provider other than the configured one", () => {
  reset();
  process.env.IMAGE_PROVIDER = "fal";
  process.env.FAL_KEY = "f-key";
  process.env.GEMINI_API_KEY = "g-key";
  assert.equal(buildImageProvider([], { imageProvider: "gemini" }).providerId, "gemini");
  reset();
});

test("an override model reaches the selected provider", () => {
  reset();
  process.env.IMAGE_PROVIDER = "fal";
  process.env.FAL_KEY = "f-key";
  assert.equal(buildImageProvider([], { imageModel: "fal-ai/hand-typed" }).modelId, "fal-ai/hand-typed");
  reset();
});

test("an override naming the already-configured provider keeps the configured path's behaviour", () => {
  reset();
  process.env.IMAGE_PROVIDER = "openai"; // no OPENAI_API_KEY
  const missing: string[] = [];
  // Still mock, still reported - an override that changes nothing must change nothing.
  assert.equal(buildImageProvider(missing, { imageProvider: "openai" }).providerId, "mock");
  assert.ok(missing.some((m) => m.includes("OPENAI_API_KEY")));
  reset();
});

test("override path: an unknown provider name falls back to the configured provider, not mock", () => {
  reset();
  process.env.IMAGE_PROVIDER = "fal";
  process.env.FAL_KEY = "f-key";
  assert.equal(buildImageProvider([], { imageProvider: "not-a-provider" }).providerId, "fal");
  reset();
});

test("override path: a known provider with no API key falls back to the configured provider, not mock", () => {
  reset();
  process.env.IMAGE_PROVIDER = "fal";
  process.env.FAL_KEY = "f-key"; // openai deliberately has no key
  assert.equal(buildImageProvider([], { imageProvider: "openai" }).providerId, "fal");
  reset();
});

test("override fallback drops the model override, which belonged to the provider that failed", () => {
  reset();
  process.env.IMAGE_PROVIDER = "fal";
  process.env.FAL_KEY = "f-key";
  const provider = buildImageProvider([], { imageProvider: "openai", imageModel: "gpt-image-1.5" });
  assert.equal(provider.providerId, "fal");
  assert.equal(provider.modelId, "fal-ai/flux/schnell", "an OpenAI model id must not be carried onto fal");
  reset();
});
