import { test } from "node:test";
import assert from "node:assert/strict";
import { GenerateRequestSchema } from "./schema.js";

// L1: a `mode`-less request must default to "search". The default has to be applied before the
// discriminatedUnion resolves its branch — a `.default` on the branch's own literal never fires.
test("GenerateRequestSchema defaults a mode-less body to search", () => {
  const parsed = GenerateRequestSchema.safeParse({ query: "volcanoes", session_id: "s1" });
  assert.equal(parsed.success, true);
  assert.equal(parsed.success && parsed.data.mode, "search");
  // Branch defaults still apply through the preprocess wrapper.
  assert.equal(parsed.success && parsed.data.aspect_ratio, "16:9");
});

test("GenerateRequestSchema accepts an explicit search request", () => {
  const parsed = GenerateRequestSchema.safeParse({ mode: "search", query: "volcanoes", session_id: "s1" });
  assert.equal(parsed.success, true);
  assert.equal(parsed.success && parsed.data.mode, "search");
});

test("GenerateRequestSchema still routes an explicit tap request to the tap branch", () => {
  const parsed = GenerateRequestSchema.safeParse({
    mode: "tap",
    markedImage: "data:image/png;base64,AAAA",
    parent_title: "t",
    session_id: "s1",
    current_node_id: "n1",
  });
  assert.equal(parsed.success, true);
  assert.equal(parsed.success && parsed.data.mode, "tap");
});

test("GenerateRequestSchema still rejects a mode-less body that is otherwise invalid", () => {
  // Defaulting mode to "search" must not paper over a missing required field (query).
  const parsed = GenerateRequestSchema.safeParse({ session_id: "s1" });
  assert.equal(parsed.success, false);
});
