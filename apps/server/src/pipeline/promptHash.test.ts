import { test } from "node:test";
import assert from "node:assert/strict";
import { computePromptHash } from "./promptHash.js";

test("is deterministic for identical inputs", () => {
  const a = computePromptHash("A page about cats", "16:9", "seedream-4-5-251128", "ark");
  const b = computePromptHash("A page about cats", "16:9", "seedream-4-5-251128", "ark");
  assert.equal(a, b);
});

test("differs when the prompt changes", () => {
  const base = computePromptHash("A page about cats", "16:9", "seedream-4-5-251128", "ark");
  assert.notEqual(base, computePromptHash("A page about dogs", "16:9", "seedream-4-5-251128", "ark"));
});

test("differs when the aspect ratio changes", () => {
  const base = computePromptHash("A page about cats", "16:9", "seedream-4-5-251128", "ark");
  assert.notEqual(base, computePromptHash("A page about cats", "1:1", "seedream-4-5-251128", "ark"));
});

test("differs when the model changes", () => {
  const base = computePromptHash("A page about cats", "16:9", "seedream-4-5-251128", "ark");
  assert.notEqual(base, computePromptHash("A page about cats", "16:9", "seedream-4-0-250828", "ark"));
});

test("differs when the provider changes", () => {
  const base = computePromptHash("A page about cats", "16:9", "seedream-4-5-251128", "ark");
  assert.notEqual(base, computePromptHash("A page about cats", "16:9", "seedream-4-5-251128", "fal"));
});

test("is a 64-char lowercase hex sha-256 digest", () => {
  const h = computePromptHash("x", "1:1", "m", "p");
  assert.match(h, /^[0-9a-f]{64}$/);
});
