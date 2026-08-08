import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_OVERRIDE_DURATION_SECONDS, getVideoDurationSeconds, getVideoResolution } from "./videoConfig.js";

const KEYS = ["VIDEO_RESOLUTION", "VIDEO_DURATION_SECONDS"];
function reset(): void {
  for (const k of KEYS) delete process.env[k];
}

test("resolution: with no override, behaves exactly as before overrides existed", () => {
  reset();
  assert.equal(getVideoResolution(), "480p", "built-in default");
  process.env.VIDEO_RESOLUTION = "720p";
  assert.equal(getVideoResolution(), "720p", "configured value");
  reset();
});

test("resolution: a valid override wins over the configured value", () => {
  reset();
  process.env.VIDEO_RESOLUTION = "480p";
  assert.equal(getVideoResolution("1080p"), "1080p");
  reset();
});

test("resolution: an override outside the accepted set falls through to the configured value", () => {
  reset();
  process.env.VIDEO_RESOLUTION = "720p";
  // Never reaches the provider: 4K is not a resolution the video API accepts.
  assert.equal(getVideoResolution("4K"), "720p");
  assert.equal(getVideoResolution(""), "720p");
  reset();
});

test("resolution: a bad CONFIGURED value still degrades to the safe built-in default", () => {
  reset();
  process.env.VIDEO_RESOLUTION = "nonsense";
  assert.equal(getVideoResolution(), "480p");
  assert.equal(getVideoResolution("nonsense-too"), "480p");
  reset();
});

test("duration: with no override, behaves exactly as before overrides existed", () => {
  reset();
  assert.equal(getVideoDurationSeconds(), 5, "built-in default");
  process.env.VIDEO_DURATION_SECONDS = "3";
  assert.equal(getVideoDurationSeconds(), 3, "configured value");
  reset();
});

test("duration: a positive override wins, and fractions are floored", () => {
  reset();
  process.env.VIDEO_DURATION_SECONDS = "3";
  assert.equal(getVideoDurationSeconds(8), 8);
  assert.equal(getVideoDurationSeconds(6.9), 6);
  reset();
});

test("duration: a client-supplied override is capped, but the configured value is not", () => {
  reset();
  // The endpoint has no auth and video burns quota fast, so an over-large request is clamped...
  assert.equal(getVideoDurationSeconds(600), MAX_OVERRIDE_DURATION_SECONDS);
  // ...while an operator editing config.yml is trusted to mean it.
  process.env.VIDEO_DURATION_SECONDS = "60";
  assert.equal(getVideoDurationSeconds(), 60);
  reset();
});

test("duration: junk overrides are ignored in favour of the configured value", () => {
  reset();
  process.env.VIDEO_DURATION_SECONDS = "3";
  for (const junk of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(getVideoDurationSeconds(junk), 3, `expected ${junk} to be ignored`);
  }
  reset();
});
