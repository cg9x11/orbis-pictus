import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModelSettings } from "./catalog.js";
import type { ProviderOption } from "@flipbook/shared";

const KEYS = [
  "IMAGE_PROVIDER",
  "ARK_API_KEY",
  "FAL_KEY",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "ARK_IMAGE_MODEL",
  "VIDEO_PROVIDER",
  "VIDEO_RESOLUTION",
  "VIDEO_DURATION_SECONDS",
];
function reset(): void {
  for (const k of KEYS) delete process.env[k];
}

function byName(options: ProviderOption[], name: string): ProviderOption {
  const found = options.find((o) => o.name === name);
  assert.ok(found, `expected a "${name}" option`);
  return found;
}

test("available mirrors key presence, and a declared-but-empty key counts as missing", () => {
  reset();
  process.env.ARK_API_KEY = "ark-key";
  process.env.OPENAI_API_KEY = ""; // the real-world case: left blank after copying .env.example
  process.env.GEMINI_API_KEY = "   "; // whitespace is not a key either
  // FAL_KEY deliberately unset.

  const { image } = buildModelSettings();
  assert.equal(byName(image.providers, "ark").available, true);
  assert.equal(byName(image.providers, "openai").available, false);
  assert.equal(byName(image.providers, "gemini").available, false);
  assert.equal(byName(image.providers, "fal").available, false);
  assert.equal(byName(image.providers, "mock").available, true, "the mock needs no key");
  reset();
});

test("the payload never carries a key value, only booleans", () => {
  reset();
  const secret = "sk-super-secret-do-not-leak-0123456789";
  for (const k of ["ARK_API_KEY", "FAL_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY"]) process.env[k] = secret;

  assert.ok(!JSON.stringify(buildModelSettings()).includes(secret), "an API key reached the client");
  reset();
});

test("the model in use is always offered, even when this catalog has never heard of it", () => {
  reset();
  process.env.IMAGE_PROVIDER = "ark";
  process.env.ARK_API_KEY = "ark-key";
  process.env.ARK_IMAGE_MODEL = "seedream-from-the-future";

  const { image } = buildModelSettings();
  assert.equal(image.model, "seedream-from-the-future");

  const ark = byName(image.providers, "ark");
  assert.equal(ark.models[0], "seedream-from-the-future", "listed first so the panel shows it selected");
  assert.ok(ark.models.includes("seedream-4-5-251128"), "and the known ids are still offered");

  // It belongs to ark only — it must not be grafted onto a provider it means nothing to.
  assert.ok(!byName(image.providers, "fal").models.includes("seedream-from-the-future"));
  reset();
});

test("a known model in use is not duplicated in its own list", () => {
  reset();
  process.env.IMAGE_PROVIDER = "ark";
  process.env.ARK_API_KEY = "ark-key";
  process.env.ARK_IMAGE_MODEL = "seedream-4-0-250828";

  const ark = byName(buildModelSettings().image.providers, "ark");
  assert.equal(ark.models.filter((m) => m === "seedream-4-0-250828").length, 1);
  reset();
});

test("video settings report the configured values and the server's duration ceiling", () => {
  reset();
  process.env.VIDEO_PROVIDER = "mock";
  process.env.VIDEO_RESOLUTION = "1080p";
  process.env.VIDEO_DURATION_SECONDS = "7";

  const { video } = buildModelSettings();
  assert.equal(video.provider, "mock");
  assert.equal(video.resolution, "1080p");
  assert.equal(video.durationSeconds, 7);
  assert.deepEqual(video.resolutions, ["480p", "720p", "1080p"]);
  assert.equal(video.maxDurationSeconds, 12, "so the panel can cap its own input");
  reset();
});

test("provider/model report what is EFFECTIVELY in use, not what config asked for", () => {
  reset();
  process.env.IMAGE_PROVIDER = "openai"; // selected, but no OPENAI_API_KEY
  const { image } = buildModelSettings();

  // The server really is drawing with the mock here, so the panel must say so rather than showing
  // a selection that isn't happening. `available: false` on openai explains why.
  assert.equal(image.provider, "mock");
  assert.equal(byName(image.providers, "openai").available, false);
  reset();
});
