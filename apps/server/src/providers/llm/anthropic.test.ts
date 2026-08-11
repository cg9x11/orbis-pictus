import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJsonLoose } from "./anthropic.js";

test("parseJsonLoose parses bare JSON", () => {
  assert.deepEqual(parseJsonLoose('{"a":1}'), { a: 1 });
});

test("parseJsonLoose strips a ```json fence wrapping the entire response", () => {
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
});

test("parseJsonLoose strips a plain ``` fence (no language tag)", () => {
  assert.deepEqual(parseJsonLoose('```\n{"a":1}\n```'), { a: 1 });
});

// Reproduces the real failure seen with web_search enabled: the model adds commentary after the
// closing fence despite the system prompt saying "no commentary" - the old anchored-fence regex
// required the fence to span the entire trimmed string, so trailing text broke it entirely.
test("parseJsonLoose recovers JSON when the model adds trailing commentary after the fence", () => {
  const text = '```json\n{"a":1}\n```\n\nLet me know if you would like any changes!';
  assert.deepEqual(parseJsonLoose(text), { a: 1 });
});

test("parseJsonLoose recovers JSON when the model adds leading commentary before the fence", () => {
  const text = 'Here is the page:\n```json\n{"a":1}\n```';
  assert.deepEqual(parseJsonLoose(text), { a: 1 });
});

test("parseJsonLoose recovers an unfenced JSON object surrounded by prose", () => {
  const text = "Sure, here you go: {\"a\":1} - hope that helps!";
  assert.deepEqual(parseJsonLoose(text), { a: 1 });
});

test("parseJsonLoose throws a helpful error when no JSON object can be found", () => {
  assert.throws(() => parseJsonLoose("no json here at all"), /Could not parse JSON/);
});
