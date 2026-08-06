import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Node } from "@flipbook/shared";

process.env.DATABASE_URL = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "flipbook-nodes-")), "test.db");

const { insertNode, findChildBySubject, findNodeByPromptHash, listGalleryNodes } = await import("./nodes.js");
const { recordTapCache, listTapCache } = await import("./tapCache.js");

let counter = 0;
function makeNode(overrides: Partial<Node> = {}): Node {
  counter += 1;
  return {
    id: `node-${counter}`,
    parent_id: null,
    session_id: "session_test",
    query: `topic ${counter}`,
    page_title: `Page ${counter}`,
    image_variants: { "16:9": `/images/node-${counter}/landscape.jpg` },
    image_model: "mock-image",
    prompt_author_model: "mock-llm",
    authored_prompt: `prompt ${counter}`,
    created_at: new Date().toISOString(),
    version: 1,
    video_status: null,
    ...overrides,
  };
}

test("findChildBySubject finds an existing child by normalized subject", () => {
  const parent = makeNode({ id: "parent-1" });
  insertNode(parent, { normalizedSubject: "root" });
  const child = makeNode({ id: "child-1", parent_id: "parent-1" });
  insertNode(child, { normalizedSubject: "pho bowl" });

  const found = findChildBySubject("parent-1", "pho bowl");
  assert.equal(found?.id, "child-1");
});

test("findChildBySubject returns null when no child under that parent matches", () => {
  const parent = makeNode({ id: "parent-2" });
  insertNode(parent, { normalizedSubject: "root" });
  const child = makeNode({ id: "child-2", parent_id: "parent-2" });
  insertNode(child, { normalizedSubject: "banh mi" });

  assert.equal(findChildBySubject("parent-2", "pho bowl"), null);
  assert.equal(findChildBySubject("some-other-parent", "banh mi"), null);
});

test("findNodeByPromptHash finds a node by its stored hash", () => {
  const node = makeNode({ id: "hashed-1" });
  insertNode(node, { normalizedSubject: "x", promptHash: "hash-abc-123" });

  assert.equal(findNodeByPromptHash("hash-abc-123")?.id, "hashed-1");
});

test("findNodeByPromptHash returns null for no match, and ignores nodes with a null hash", () => {
  const node = makeNode({ id: "no-hash-1" });
  insertNode(node, { normalizedSubject: "x", promptHash: null });

  assert.equal(findNodeByPromptHash("does-not-exist"), null);
});

test("listGalleryNodes returns up to `limit` already-persisted nodes", () => {
  for (let i = 0; i < 5; i++) {
    insertNode(makeNode(), { normalizedSubject: "gallery" });
  }
  const gallery = listGalleryNodes(3);
  assert.equal(gallery.length, 3);
  for (const node of gallery) {
    assert.equal(typeof node.id, "string");
  }
});

// An edit variant keeps its parent's exact page_title (e.g. a "make it night time" child of
// "Takoyaki" is also titled "Takoyaki"), which used to show up as two identical-looking gallery
// cards for what looks like the same node. Only one row per title should ever be sampled, and it
// should prefer the root node over the edit-variant child as the canonical representative.
test("listGalleryNodes dedups by page_title, preferring the root node over a same-titled child", () => {
  const root = makeNode({ id: "takoyaki-root", parent_id: null, page_title: "Takoyaki" });
  insertNode(root, { normalizedSubject: "takoyaki" });
  const editChild = makeNode({ id: "takoyaki-night-edit", parent_id: "takoyaki-root", page_title: "Takoyaki" });
  insertNode(editChild, { normalizedSubject: "takoyaki" });

  const gallery = listGalleryNodes(50);
  const takoyakiCards = gallery.filter((n) => n.page_title === "Takoyaki");
  assert.equal(takoyakiCards.length, 1);
  assert.equal(takoyakiCards[0]?.id, "takoyaki-root");
});

// The gallery offers starting points, so it shows only the opening page of an exploration. A tap
// child is a mid-exploration page with a title of its own ("Roadway Deck"), which the page_title
// dedup above would happily let through — it has to be excluded by being a child, not by title.
// Two taps landing under one visual marker are the same click as far as findTapCacheHit is
// concerned, so drawing both would put two dots on one target (PLAN §2.3).
test("listTapCache collapses points that fall under the same tap marker", () => {
  recordTapCache("tapcache-node", "16:9", 0.5, 0.5, "Main Tower");
  recordTapCache("tapcache-node", "16:9", 0.505, 0.502, "Main Tower");
  recordTapCache("tapcache-node", "16:9", 0.9, 0.8, "Far Corner");

  const points = listTapCache("tapcache-node", "16:9");
  assert.equal(points.length, 2);
  assert.deepEqual(
    points.map((p) => p.subject),
    ["Main Tower", "Far Corner"],
  );
  // Keyed per aspect ratio: the same coordinates mean a different place on a differently-shaped image.
  assert.equal(listTapCache("tapcache-node", "3:4").length, 0);
});

test("listGalleryNodes returns every eligible node when the limit is null", () => {
  for (let i = 0; i < 30; i++) {
    insertNode(makeNode(), { normalizedSubject: "unlimited" });
  }
  // Well past MAX_GALLERY_LIMIT (24), so a lingering cap anywhere below would show up here.
  assert.ok(listGalleryNodes(null).length >= 30);
  assert.equal(listGalleryNodes(3).length, 3);
});

test("listGalleryNodes excludes tap children, returning only root nodes", () => {
  const root = makeNode({ id: "bridge-root", parent_id: null, page_title: "Golden Gate Bridge" });
  insertNode(root, { normalizedSubject: "golden gate bridge" });
  const tapChild = makeNode({ id: "bridge-deck", parent_id: "bridge-root", page_title: "Roadway Deck" });
  insertNode(tapChild, { normalizedSubject: "roadway deck" });

  const gallery = listGalleryNodes(50);
  assert.ok(gallery.some((n) => n.id === "bridge-root"));
  assert.equal(gallery.some((n) => n.id === "bridge-deck"), false);
  assert.equal(gallery.every((n) => n.parent_id === null), true);
});
