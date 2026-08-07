import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Node } from "@flipbook/shared";
import type { VideoGenInput, VideoGenResult, VideoProvider } from "../providers/types.js";

// Must be set before ./video.js (imports storage/nodes.js -> storage/db.js) runs its module-level
// migrate(), same pattern as generate.test.ts. VIDEO_ENABLED/VIDEO_MAX_PER_SESSION are read
// per-call (not at import time) by videoConfig.ts, so setting them here for the whole file is fine.
process.env.DATABASE_URL = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "flipbook-video-")), "test.db");
process.env.VIDEO_ENABLED = "true";
process.env.VIDEO_MAX_PER_SESSION = "2";

const { createVideoPipeline } = await import("./video.js");
const { saveImageVariant } = await import("./imageStorage.js");
const { insertNode, getVideoInfo } = await import("../storage/nodes.js");
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

function makeNode(id: string, sessionId: string, imagesDir: string): Node {
  const imageUrl = saveImageVariant(imagesDir, id, "16:9", Buffer.from(`pixels-${id}`), "image/jpeg");
  return {
    id,
    parent_id: null,
    session_id: sessionId,
    query: "q",
    page_title: "Title",
    image_variants: { "16:9": imageUrl },
    image_model: "mock-image",
    prompt_author_model: "mock-llm",
    authored_prompt: "content",
    created_at: new Date().toISOString(),
    version: 1,
    video_status: null,
    morph_status: null,
  };
}

/** Fire-and-forget generation runs as a plain async IIFE with no real awaits in the mock path, so one macrotask tick is enough to flush it. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

test("generates and stores a video for a node that has never been attempted", async () => {
  const imagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "flipbook-video-images-"));
  const pipeline = createVideoPipeline();
  const video = new SpyVideoProvider();
  const node = makeNode("node-fresh", "s-fresh", imagesDir);
  insertNode(node, { normalizedSubject: "n" });

  pipeline.maybeStartIdleLoop(node, makeProviders(video), imagesDir);
  await flush();

  assert.equal(video.calls.length, 1);
  assert.match(video.calls[0]!.firstFrameDataUrl, /^data:image\/jpeg;base64,/);
  const info = getVideoInfo(node.id);
  assert.equal(info?.status, "ready");
  assert.equal(info?.url, `/images/${node.id}/loop.mp4`);
});

test("a node that already has a stored video is never regenerated", async () => {
  const imagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "flipbook-video-images-"));
  const pipeline = createVideoPipeline();
  const video = new SpyVideoProvider();
  const node = makeNode("node-already-ready", "s-ready", imagesDir);
  insertNode(node, { normalizedSubject: "n" });

  pipeline.maybeStartIdleLoop(node, makeProviders(video), imagesDir);
  await flush();
  assert.equal(video.calls.length, 1, "first call should have generated");

  // Revisit the same node (a fresh pipeline instance, like a new request in the real app).
  createVideoPipeline().maybeStartIdleLoop(node, makeProviders(video), imagesDir);
  await flush();
  assert.equal(video.calls.length, 1, "second visit must not trigger a new generation");
});

test("a node whose generation already failed is not retried", async () => {
  const imagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "flipbook-video-images-"));
  const video = new SpyVideoProvider();
  video.shouldFail = true;
  const node = makeNode("node-failed", "s-failed", imagesDir);
  insertNode(node, { normalizedSubject: "n" });

  createVideoPipeline().maybeStartIdleLoop(node, makeProviders(video), imagesDir);
  await flush();
  assert.equal(video.calls.length, 1);
  assert.equal(getVideoInfo(node.id)?.status, "failed");

  createVideoPipeline().maybeStartIdleLoop(node, makeProviders(video), imagesDir);
  await flush();
  assert.equal(video.calls.length, 1, "a failed attempt must not be retried automatically");
});

test("concurrent calls for the same node in-flight are deduplicated", async () => {
  const imagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "flipbook-video-images-"));
  const pipeline = createVideoPipeline();
  const video = new SpyVideoProvider();
  const node = makeNode("node-concurrent", "s-concurrent", imagesDir);
  insertNode(node, { normalizedSubject: "n" });

  // Both calls happen synchronously, before the first generation's background promise resolves.
  pipeline.maybeStartIdleLoop(node, makeProviders(video), imagesDir);
  pipeline.maybeStartIdleLoop(node, makeProviders(video), imagesDir);
  await flush();

  assert.equal(video.calls.length, 1);
});

test("VIDEO_MAX_PER_SESSION caps generations per session_id, across distinct nodes", async () => {
  const imagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "flipbook-video-images-"));
  const pipeline = createVideoPipeline();
  const video = new SpyVideoProvider();
  const sessionId = "s-capped";
  const nodes = ["cap-a", "cap-b", "cap-c"].map((id) => makeNode(id, sessionId, imagesDir));
  for (const node of nodes) insertNode(node, { normalizedSubject: "n" });

  // VIDEO_MAX_PER_SESSION=2 (set at the top of this file) — the third node in the same session must be skipped.
  for (const node of nodes) pipeline.maybeStartIdleLoop(node, makeProviders(video), imagesDir);
  await flush();

  assert.equal(video.calls.length, 2);
  assert.equal(getVideoInfo(nodes[2]!.id)?.status, null);
});

test("VIDEO_ENABLED=false disables generation entirely, synchronously", async () => {
  const originalValue = process.env.VIDEO_ENABLED;
  process.env.VIDEO_ENABLED = "false";
  try {
    const imagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "flipbook-video-images-"));
    const pipeline = createVideoPipeline();
    const video = new SpyVideoProvider();
    const node = makeNode("node-disabled", "s-disabled", imagesDir);
    insertNode(node, { normalizedSubject: "n" });

    pipeline.maybeStartIdleLoop(node, makeProviders(video), imagesDir);
    await flush();

    assert.equal(video.calls.length, 0);
    assert.equal(getVideoInfo(node.id)?.status, null);
  } finally {
    process.env.VIDEO_ENABLED = originalValue;
  }
});

// The client decides whether to wait for a clip purely from the node's video_status, treating null
// as "no clip will ever exist here". That makes the ORDER inside runGenerate load-bearing: the
// background generation has to be kicked off, and the node re-read, before `complete` is emitted.
// Emit first and the payload says null forever, so a page that is actively generating a clip would
// never pick it up — the exact silent-wait bug this field was added to remove.
test("the `complete` event already reports video_status pending when a clip is on its way", async () => {
  const { runGenerate } = await import("./generate.js");
  const imagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "flipbook-video-complete-"));
  const events: { event: string; data: unknown }[] = [];

  const { createMorphPipeline } = await import("./morph.js");
  const node = await runGenerate(
    { mode: "search", query: "a topic", aspect_ratio: "16:9", web_search: false, video_loop: true, session_id: "s-complete", current_node_id: "" },
    { providers: makeProviders(new SpyVideoProvider()), imagesDir, video: createVideoPipeline(), morph: createMorphPipeline() },
    (event) => {
      events.push({ event: event.event, data: event.data });
    },
  );

  const complete = events.find((e) => e.event === "complete");
  assert.ok(complete, "a complete event should have been emitted");
  assert.equal((complete.data as Node).video_status, "pending");
  assert.equal(node.video_status, "pending");
});
