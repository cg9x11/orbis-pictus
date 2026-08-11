import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Node, NodeTapsResponse } from "@orbis/shared";
import type { Providers } from "../providers/index.js";
import type { VideoPipeline } from "../pipeline/video.js";
import type { MorphPipeline } from "../pipeline/morph.js";

// Set before the storage module is imported: db.ts opens its database at module scope.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbis-taps-"));
process.env.DATABASE_URL = path.join(tmpDir, "test.db");
const imagesDir = path.join(tmpDir, "images");

const { insertNode, insertVersionAsDefault } = await import("../storage/nodes.js");
const { recordTapCache } = await import("../storage/tapCache.js");
const { normalizeSubject } = await import("../pipeline/normalize.js");
const { nodesRoute } = await import("./nodes.js");

/** The taps route reads storage only - it never resolves a provider or touches either pipeline. */
const resolveProviders = (() => ({}) as unknown as Providers) as never;
const noPipelines = {
  video: {} as unknown as VideoPipeline,
  morph: {} as unknown as MorphPipeline,
};

let counter = 0;
function makeNode(overrides: Partial<Node> = {}): Node {
  counter += 1;
  return {
    id: `taps-${counter}`,
    parent_id: null,
    session_id: "session_test",
    query: `topic ${counter}`,
    page_title: `Page ${counter}`,
    image_variants: { "16:9": `/images/taps-${counter}/landscape.jpg` },
    image_model: "mock-image",
    image_provider: "mock",
    art_style: "felt",
    composition: "diorama",
    prompt_author_model: "mock-llm",
    authored_prompt: `prompt ${counter}`,
    created_at: new Date().toISOString(),
    version: 1,
    video_status: null,
    morph_status: null,
    ...overrides,
  };
}

/** One parent with a cached tap at (0.4, 0.4) resolving to `childCount` children of one subject. */
function seed(parentId: string, subject: string, childCount: number): void {
  insertNode(makeNode({ id: parentId }), { normalizedSubject: "root" });
  recordTapCache(parentId, "16:9", 0.4, 0.4, subject);
  for (let i = 0; i < childCount; i += 1) {
    insertNode(
      makeNode({
        id: `${parentId}-child-${i}`,
        parent_id: parentId,
        page_title: `${subject} ${i}`,
        image_variants: { "16:9": `/images/${parentId}-child-${i}/landscape.jpg` },
        created_at: `2026-0${i + 1}-01T00:00:00.000Z`,
      }),
      { normalizedSubject: normalizeSubject(subject) },
    );
  }
}

async function tapsBody(nodeId: string): Promise<NodeTapsResponse> {
  const app = nodesRoute(resolveProviders, imagesDir, noPipelines.video, noPipelines.morph);
  const res = await app.request(`/${nodeId}/taps?ratio=16:9`);
  assert.equal(res.status, 200);
  return (await res.json()) as NodeTapsResponse;
}

test("taps: reuse mode reports the mode and the child behind each explored spot", async () => {
  process.env.TAP_DEDUP = "reuse";
  seed("taps-parent-reuse", "Roadway Deck", 1);

  const body = await tapsBody("taps-parent-reuse");
  assert.equal(body.mode, "reuse");
  assert.equal(body.taps.length, 1);
  assert.equal(body.taps[0]!.subject, "Roadway Deck");
  assert.deepEqual(
    body.taps[0]!.children.map((c) => c.id),
    ["taps-parent-reuse-child-0"],
  );
  assert.equal(body.taps[0]!.children[0]!.image_url, "/images/taps-parent-reuse-child-0/landscape.jpg");
});

test("taps: a marker resolves to the group's DEFAULT version, not the old primary child", async () => {
  process.env.TAP_DEDUP = "reuse";
  seed("taps-parent-versioned", "Gargoyle", 1);
  // Edit the primary child into a new version that becomes the group default.
  insertVersionAsDefault(
    makeNode({
      id: "gargoyle-v2",
      parent_id: "taps-parent-versioned",
      page_title: "Gargoyle (stone)",
      image_variants: { "16:9": "/images/gargoyle-v2/landscape.jpg" },
      created_at: "2026-06-01T00:00:00.000Z",
      version_group_id: "taps-parent-versioned-child-0",
      edited_from_id: "taps-parent-versioned-child-0",
    }),
    { normalizedSubject: normalizeSubject("Gargoyle") },
  );

  const body = await tapsBody("taps-parent-versioned");
  // The marker must point at the default (gargoyle-v2), not the primary (…-child-0).
  assert.deepEqual(body.taps[0]!.children.map((c) => c.id), ["gargoyle-v2"]);
  assert.equal(body.taps[0]!.children[0]!.image_url, "/images/gargoyle-v2/landscape.jpg");
});

test("taps: variant mode returns every version of a subject, not an arbitrary one", async () => {
  process.env.TAP_DEDUP = "variant";
  seed("taps-parent-variant", "Roadway Deck", 3);

  const body = await tapsBody("taps-parent-variant");
  assert.equal(body.mode, "variant");
  assert.equal(body.taps.length, 1);
  // The whole reason `children` is a list: under variant each repeat tap adds another page, and
  // picking one to show would present an arbitrary choice as the answer.
  assert.deepEqual(
    body.taps[0]!.children.map((c) => c.id),
    ["taps-parent-variant-child-0", "taps-parent-variant-child-1", "taps-parent-variant-child-2"],
  );
});

test("taps: off mode returns nothing even when cached rows and children exist", async () => {
  // The case the mode gate exists for. Rows recorded during an earlier run under reuse/variant stay
  // in the table, so without the gate a switch to `off` would keep drawing markers for a mode that
  // ignores the cache entirely.
  process.env.TAP_DEDUP = "variant";
  seed("taps-parent-off", "Roadway Deck", 2);
  assert.equal((await tapsBody("taps-parent-off")).taps.length, 1, "rows exist before the mode switch");

  process.env.TAP_DEDUP = "off";
  const body = await tapsBody("taps-parent-off");
  assert.equal(body.mode, "off");
  assert.deepEqual(body.taps, []);
});

test("taps: a cached spot whose subject never produced a child is dropped", async () => {
  process.env.TAP_DEDUP = "variant";
  // A tap-cache row on its own only means the VLM call was skipped. It is not something the user can
  // act on, so it must not become a marker.
  insertNode(makeNode({ id: "taps-parent-orphan" }), { normalizedSubject: "root" });
  recordTapCache("taps-parent-orphan", "16:9", 0.6, 0.6, "Nothing Was Ever Drawn Here");

  assert.deepEqual((await tapsBody("taps-parent-orphan")).taps, []);
});

test("taps: an unknown or missing ratio is rejected", async () => {
  process.env.TAP_DEDUP = "reuse";
  const app = nodesRoute(resolveProviders, imagesDir, noPipelines.video, noPipelines.morph);
  assert.equal((await app.request("/taps-parent-reuse/taps?ratio=21:9")).status, 400);
  assert.equal((await app.request("/taps-parent-reuse/taps")).status, 400);
});
