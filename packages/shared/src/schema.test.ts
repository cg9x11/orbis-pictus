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

// The settings panel's number input can yield a non-integer, and the whole request used to die of
// it: `.int()` failed, the merged schema rejected, and the route answered 400. Every generation
// stopped until the user cleared the field, over a control that is supposed to be optional.
test("a non-integer duration is dropped instead of failing the whole request", () => {
  const parsed = GenerateRequestSchema.safeParse({
    query: "volcanoes",
    session_id: "s1",
    video_duration_seconds: 5.5,
  });
  assert.equal(parsed.success, true);
  assert.equal(parsed.success && parsed.data.video_duration_seconds, undefined);
});

// The point of per-field recovery: one unusable value must not take the good ones with it.
test("one bad override does not discard the others", () => {
  const parsed = GenerateRequestSchema.safeParse({
    query: "volcanoes",
    session_id: "s1",
    video_duration_seconds: 0,
    image_provider: "fal",
    image_model: "flux-pro",
  });
  assert.equal(parsed.success, true);
  assert.equal(parsed.success && parsed.data.image_provider, "fal");
  assert.equal(parsed.success && parsed.data.image_model, "flux-pro");
  assert.equal(parsed.success && parsed.data.video_duration_seconds, undefined);
});

// Recovery must not turn into indifference: a value that IS valid still has to arrive intact.
test("a valid duration still passes through untouched", () => {
  const parsed = GenerateRequestSchema.safeParse({
    query: "volcanoes",
    session_id: "s1",
    video_duration_seconds: 8,
  });
  assert.equal(parsed.success && parsed.data.video_duration_seconds, 8);
});

// A stale client can send the wrong TYPE, not just the wrong value. Same outcome: drop the field.
test("a wrongly-typed override degrades to the server default", () => {
  const parsed = GenerateRequestSchema.safeParse({
    query: "volcanoes",
    session_id: "s1",
    image_provider: 42,
    video_duration_seconds: "6",
  });
  assert.equal(parsed.success, true);
  assert.equal(parsed.success && parsed.data.image_provider, undefined);
  assert.equal(parsed.success && parsed.data.video_duration_seconds, undefined);
});
