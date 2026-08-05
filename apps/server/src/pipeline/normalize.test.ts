import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSubject } from "./normalize.js";

test("lowercases, trims, and collapses internal whitespace", () => {
  assert.equal(normalizeSubject("  Phở   Bowl  "), "phở bowl");
});

test("differently-cased/whitespaced input normalizes equal", () => {
  assert.equal(normalizeSubject("Notre Dame"), normalizeSubject("  notre   dame "));
});

test("is idempotent", () => {
  const once = normalizeSubject("The  Eiffel Tower");
  assert.equal(normalizeSubject(once), once);
});
