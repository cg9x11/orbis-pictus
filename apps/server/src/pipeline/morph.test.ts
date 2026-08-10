import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Node } from "@orbis/shared";
import type { VideoGenInput, VideoGenResult, VideoProvider } from "../providers/types.js";

// Must be set before ./morph.js (imports storage/nodes.js -> storage/db.js) runs its module-level
// migrate(), same pattern as video.test.ts. MORPH_ENABLED/MORPH_MAX_PER_SESSION are read per-call
// (not at import time) by morphConfig.ts, so setting them here for the whole file is fine.
process.env.DATABASE_URL = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "orbis-morph-")), "test.db");
process.env.MORPH_ENABLED = "true";
process.env.MORPH_MAX_PER_SESSION = "2";
// The clips here are a few fake bytes, not real mp4s, so the reverse re-encode would spawn a real
// ffmpeg per case only to fail on them. Off keeps the suite free of subprocesses; writeReversedMorph
// has its own graceful-failure path and is not what these tests are covering.
process.env.MORPH_REVERSE = "false";

const { createMorphPipeline } = await import("./morph.js");
const { saveImageVariant } = await import("./imageStorage.js");
const { insertNode, insertVersionAsDefault, getMorphInfo } = await import("../storage/nodes.js");
const { MockLlmProvider } = await import("../providers/llm/mock.js");
const { MockImageProvider } = await import("../providers/image/mock.js");
const { NoneSearchProvider } = await import("../providers/search/none.js");

class SpyVideoProvider implements VideoProvider {
  readonly modelId = "spy-video";
  readonly providerId = "spy";
  calls: VideoGenInput[] = [];
  shouldFail = false;

  async generate(input: VideoGenInput): Promise<VideoGenResult> {
    this.calls.push(input);
    if (this.shouldFail) throw new Error("provider exploded");
    return { bytes: Buffer.from("fake-mp4-bytes"), contentType: "video/mp4" };
  }
}

function makeProviders(video: VideoProvider) {
  return { llm: new MockLlmProvider(), image: new MockImageProvider(), video, search: new NoneSearchProvider() };
}

function makeNode(id: string, sessionId: string, imagesDir: string, parentId: string | null): Node {
  const imageUrl = saveImageVariant(imagesDir, id, "16:9", Buffer.from(`pixels-${id}`), "image/jpeg");
  return {
    id,
    parent_id: parentId,
    session_id: sessionId,
    query: "q",
    page_title: "Title",
    image_variants: { "16:9": imageUrl },
    image_model: "mock-image",
    image_provider: "mock",
    art_style: "felt",
    composition: "diorama",
    prompt_author_model: "mock-llm",
    authored_prompt: "content",
    created_at: new Date().toISOString(),
    version: 1,
    video_status: null,
    morph_status: null,
  };
}

/** Inserts a parent + child pair sharing one imagesDir, both with a 16:9 variant, and returns the child. */
function makeParentChild(prefix: string, sessionId: string, imagesDir: string): { parent: Node; child: Node } {
  const parent = makeNode(`${prefix}-parent`, sessionId, imagesDir, null);
  insertNode(parent, { normalizedSubject: "n" });
  const child = makeNode(`${prefix}-child`, sessionId, imagesDir, parent.id);
  insertNode(child, { normalizedSubject: "n" });
  return { parent, child };
}

/** Fire-and-forget generation runs as a plain async IIFE with no real awaits in the mock path, so one macrotask tick is enough to flush it. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

test("triggers a morph generation for a fresh child, using the parent as first frame and the child as last frame", async () => {
  const imagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbis-morph-images-"));
  const pipeline = createMorphPipeline();
  const video = new SpyVideoProvider();
  const { parent, child } = makeParentChild("fresh", "s-fresh", imagesDir);

  pipeline.maybeStartMorph(child, makeProviders(video), imagesDir);
  await flush();

  assert.equal(video.calls.length, 1);
  assert.equal(video.calls[0]!.firstFrameDataUrl, `data:image/jpeg;base64,${Buffer.from(`pixels-${parent.id}`).toString("base64")}`);
  assert.equal(video.calls[0]!.lastFrameDataUrl, `data:image/jpeg;base64,${Buffer.from(`pixels-${child.id}`).toString("base64")}`);
  const info = getMorphInfo(child.id);
  assert.equal(info?.status, "ready");
  assert.equal(info?.url, `/images/${child.id}/morph.mp4`);
});

test("an edit version morphs from the version it was edited from, even when its parent_id is null", async () => {
  const imagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbis-morph-images-"));
  const pipeline = createMorphPipeline();
  const video = new SpyVideoProvider();

  // A root page (day) and its night EDIT version. In the peer model a version's parent_id is null
  // (it inherits the root's null parent), so the morph must key off edited_from_id, not parent_id.
  const day = makeNode("edit-day", "s-edit-morph", imagesDir, null);
  insertNode(day, { normalizedSubject: "n" });
  const night: Node = {
    ...makeNode("edit-night", "s-edit-morph", imagesDir, null),
    edited_from_id: "edit-day",
    version_group_id: "edit-day",
  };
  // The real edit path: night joins day's group and becomes its default, so the old default (day) is
  // cleared in the same transaction — a plain insert would trip the one-default-per-group index.
  insertVersionAsDefault(night, { normalizedSubject: "n" });

  pipeline.maybeStartMorph(night, makeProviders(video), imagesDir);
  await flush();

  assert.equal(video.calls.length, 1);
  assert.equal(video.calls[0]!.firstFrameDataUrl, `data:image/jpeg;base64,${Buffer.from("pixels-edit-day").toString("base64")}`);
  assert.equal(video.calls[0]!.lastFrameDataUrl, `data:image/jpeg;base64,${Buffer.from("pixels-edit-night").toString("base64")}`);
  assert.equal(getMorphInfo(night.id)?.status, "ready");
});

test("the morph prompt is tailored to the two frames by the VLM, not the static fallback", async () => {
  const imagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbis-morph-images-"));
  const pipeline = createMorphPipeline();
  const video = new SpyVideoProvider();
  const { child } = makeParentChild("vlm-prompt", "s-vlm", imagesDir);

  pipeline.maybeStartMorph(child, makeProviders(video), imagesDir);
  await flush();

  assert.equal(video.calls.length, 1);
  // MockLlmProvider.describeMorphMotion tags its output with [mock]; the static fallback never would.
  assert.match(video.calls[0]!.prompt, /\[mock\]/);
});

// The automatic path only fires the instant a child is created, and only while Live video is on, so
// a child made with it off — or reopened from a cached tap marker, which never runs the generate
// pipeline at all — could previously never get a morph by any route. startMorphNow is that route.
test("startMorphNow: generates for a child the automatic path never attempted", async () => {
  const imagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbis-morph-images-"));
  const video = new SpyVideoProvider();
  const { child } = makeParentChild("on-demand", "s-on-demand", imagesDir);

  // No maybeStartMorph ever ran for this child — exactly a page created with Live video off.
  assert.equal(getMorphInfo(child.id)?.status, null);

  const result = createMorphPipeline().startMorphNow(child, makeProviders(video), imagesDir);
  await flush();

  assert.equal(result, "started");
  assert.equal(video.calls.length, 1);
  assert.equal(getMorphInfo(child.id)?.status, "ready");
});

test("startMorphNow: a previously-failed child IS retried (unlike the automatic path)", async () => {
  const imagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbis-morph-images-"));
  const video = new SpyVideoProvider();
  video.shouldFail = true;
  const { child } = makeParentChild("on-demand-retry", "s-on-demand-retry", imagesDir);

  createMorphPipeline().maybeStartMorph(child, makeProviders(video), imagesDir);
  await flush();
  assert.equal(getMorphInfo(child.id)?.status, "failed");

  video.shouldFail = false;
  const result = createMorphPipeline().startMorphNow(child, makeProviders(video), imagesDir);
  await flush();

  assert.equal(result, "started");
  assert.equal(video.calls.length, 2, "a deliberate request retries what the automatic path gave up on");
  assert.equal(getMorphInfo(child.id)?.status, "ready");
});

test("startMorphNow: a root node reports 'unavailable' rather than generating", async () => {
  const imagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbis-morph-images-"));
  const video = new SpyVideoProvider();
  const root = makeNode("on-demand-root", "s-on-demand-root", imagesDir, null);
  insertNode(root, { normalizedSubject: "n" });

  const result = createMorphPipeline().startMorphNow(root, makeProviders(video), imagesDir);
  await flush();

  assert.equal(result, "unavailable");
  assert.equal(video.calls.length, 0);
});

test("a root node (no parent) is skipped without touching the provider", async () => {
  const imagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbis-morph-images-"));
  const pipeline = createMorphPipeline();
  const video = new SpyVideoProvider();
  const root = makeNode("root-only", "s-root", imagesDir, null);
  insertNode(root, { normalizedSubject: "n" });

  pipeline.maybeStartMorph(root, makeProviders(video), imagesDir);
  await flush();

  assert.equal(video.calls.length, 0);
  assert.equal(getMorphInfo(root.id)?.status, null);
});

test("a child that already has a stored morph is never regenerated", async () => {
  const imagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbis-morph-images-"));
  const pipeline = createMorphPipeline();
  const video = new SpyVideoProvider();
  const { child } = makeParentChild("already-ready", "s-ready", imagesDir);

  pipeline.maybeStartMorph(child, makeProviders(video), imagesDir);
  await flush();
  assert.equal(video.calls.length, 1, "first call should have generated");

  // Revisit the same child (a fresh pipeline instance, like a new request in the real app).
  createMorphPipeline().maybeStartMorph(child, makeProviders(video), imagesDir);
  await flush();
  assert.equal(video.calls.length, 1, "second visit must not trigger a new generation");
});

test("a child whose morph generation already failed is not retried", async () => {
  const imagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbis-morph-images-"));
  const video = new SpyVideoProvider();
  video.shouldFail = true;
  const { child } = makeParentChild("failed", "s-failed", imagesDir);

  createMorphPipeline().maybeStartMorph(child, makeProviders(video), imagesDir);
  await flush();
  assert.equal(video.calls.length, 1);
  assert.equal(getMorphInfo(child.id)?.status, "failed");

  createMorphPipeline().maybeStartMorph(child, makeProviders(video), imagesDir);
  await flush();
  assert.equal(video.calls.length, 1, "a failed attempt must not be retried automatically");
});

test("concurrent calls for the same child in-flight are deduplicated", async () => {
  const imagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbis-morph-images-"));
  const pipeline = createMorphPipeline();
  const video = new SpyVideoProvider();
  const { child } = makeParentChild("concurrent", "s-concurrent", imagesDir);

  // Both calls happen synchronously, before the first generation's background promise resolves.
  pipeline.maybeStartMorph(child, makeProviders(video), imagesDir);
  pipeline.maybeStartMorph(child, makeProviders(video), imagesDir);
  await flush();

  assert.equal(video.calls.length, 1);
});

test("MORPH_MAX_PER_SESSION caps generations per session_id, across distinct child nodes", async () => {
  const imagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbis-morph-images-"));
  const pipeline = createMorphPipeline();
  const video = new SpyVideoProvider();
  const sessionId = "s-capped";
  const children = ["cap-a", "cap-b", "cap-c"].map((prefix) => makeParentChild(prefix, sessionId, imagesDir).child);

  // MORPH_MAX_PER_SESSION=2 (set at the top of this file) — the third child in the same session must be skipped.
  for (const child of children) pipeline.maybeStartMorph(child, makeProviders(video), imagesDir);
  await flush();

  assert.equal(video.calls.length, 2);
  assert.equal(getMorphInfo(children[2]!.id)?.status, null);
});

test("MORPH_ENABLED=false disables generation entirely, synchronously", async () => {
  const originalValue = process.env.MORPH_ENABLED;
  process.env.MORPH_ENABLED = "false";
  try {
    const imagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbis-morph-images-"));
    const pipeline = createMorphPipeline();
    const video = new SpyVideoProvider();
    const { child } = makeParentChild("disabled", "s-disabled", imagesDir);

    pipeline.maybeStartMorph(child, makeProviders(video), imagesDir);
    await flush();

    assert.equal(video.calls.length, 0);
    assert.equal(getMorphInfo(child.id)?.status, null);
  } finally {
    process.env.MORPH_ENABLED = originalValue;
  }
});

test("no morph yet -> the endpoint's underlying state is the null/never-attempted case a client reads as 'no morph, just show the page' (the instant image swap)", async () => {
  const imagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbis-morph-images-"));
  const { child } = makeParentChild("never-attempted", "s-never", imagesDir);

  // No maybeStartMorph call at all — mirrors a page nobody has revisited yet.
  const info = getMorphInfo(child.id);
  assert.equal(info?.status, null);
  assert.equal(info?.url, null);
});
