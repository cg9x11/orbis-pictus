import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Node } from "@orbis/shared";

process.env.DATABASE_URL = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "orbis-nodes-")), "test.db");

const { insertNode, findChildBySubject, findNodeByPromptHash, listGalleryNodes, getHistory, getNode, addImageVariant } =
  await import("./nodes.js");
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

test("provenance (provider, art style, composition) survives a round trip", () => {
  // The aspect-ratio variant endpoint redraws a page from these three fields, so losing them in
  // storage would silently bring back the drift they exist to prevent.
  const node = makeNode({ id: "prov-1", image_provider: "ark", image_model: "seedream-4-5-251128", art_style: "riso", composition: "flat" });
  insertNode(node, { normalizedSubject: "prov" });

  const read = getNode("prov-1");
  assert.ok(read);
  assert.equal(read.image_provider, "ark");
  assert.equal(read.image_model, "seedream-4-5-251128");
  assert.equal(read.art_style, "riso");
  assert.equal(read.composition, "flat");
});

test("a node stored with no provenance reads back as empty, not undefined", () => {
  // Rows predating these columns must still load; the variant route reads "" as "fall back to the
  // server's current settings", which is the behaviour those older pages already had.
  const node = makeNode({ id: "prov-2", image_provider: "", art_style: "", composition: "" });
  insertNode(node, { normalizedSubject: "prov2" });

  const read = getNode("prov-2");
  assert.ok(read);
  assert.equal(read.image_provider, "");
  assert.equal(read.art_style, "");
  assert.equal(read.composition, "");
});

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

test("listGalleryNodes returns nodes newest first (created_at DESC)", () => {
  insertNode(makeNode({ id: "order-old", page_title: "Order Old", created_at: "2026-01-01T00:00:00.000Z" }), {
    normalizedSubject: "order",
  });
  insertNode(makeNode({ id: "order-new", page_title: "Order New", created_at: "2026-03-01T00:00:00.000Z" }), {
    normalizedSubject: "order",
  });
  insertNode(makeNode({ id: "order-mid", page_title: "Order Mid", created_at: "2026-02-01T00:00:00.000Z" }), {
    normalizedSubject: "order",
  });

  const ordered = listGalleryNodes(null).filter((n) => n.id.startsWith("order-"));
  assert.deepEqual(
    ordered.map((n) => n.id),
    ["order-new", "order-mid", "order-old"],
  );
});

// Re-running the same search is a genuinely new page (fresh image, possibly with video/morph the
// earlier one lacked), so the gallery no longer dedups by page_title: two same-titled ROOTS each
// get their own card. The old dedup collapsed a just-created page into an older same-titled one,
// which made the new page look like it had vanished from the list. (A same-titled *child* is still
// excluded — but by the root-only filter, not by any title rule; see the tap-children test below.)
test("listGalleryNodes lists every root, keeping two roots that share a page_title (no title dedup)", () => {
  const older = makeNode({ id: "takoyaki-older", parent_id: null, page_title: "Takoyaki", created_at: "2026-01-01T00:00:00.000Z" });
  insertNode(older, { normalizedSubject: "takoyaki" });
  const newer = makeNode({ id: "takoyaki-newer", parent_id: null, page_title: "Takoyaki", created_at: "2026-02-01T00:00:00.000Z" });
  insertNode(newer, { normalizedSubject: "takoyaki" });

  const gallery = listGalleryNodes(50);
  const takoyakiIds = gallery.filter((n) => n.page_title === "Takoyaki").map((n) => n.id);
  assert.equal(takoyakiIds.length, 2);
  // Newest first, so the freshly-created page is on top where it's easy to find.
  assert.deepEqual(takoyakiIds, ["takoyaki-newer", "takoyaki-older"]);
});

// The gallery offers starting points, so it shows only the opening page of an exploration. A tap
// child is a mid-exploration page with a title of its own ("Roadway Deck"), which the page_title
// dedup above would happily let through — it has to be excluded by being a child, not by title.
// Two taps landing under one visual marker are the same click as far as findTapCacheHit is
// concerned, so drawing both would put two dots on one target.
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

test("getHistory returns the ancestor chain root -> parent, excluding the node itself", () => {
  insertNode(makeNode({ id: "hist-root", parent_id: null }), { normalizedSubject: "x" });
  insertNode(makeNode({ id: "hist-mid", parent_id: "hist-root" }), { normalizedSubject: "x" });
  insertNode(makeNode({ id: "hist-leaf", parent_id: "hist-mid" }), { normalizedSubject: "x" });

  assert.deepEqual(
    getHistory("hist-leaf").map((n) => n.id),
    ["hist-root", "hist-mid"],
  );
});

// A parent_id cycle must never make getHistory loop forever (node:sqlite is synchronous, so a
// spin would hang the whole event loop — a trivial DoS). The route layer refuses to store such a
// row, but the walk itself has to be self-protecting regardless of how a bad row got there.
test("getHistory terminates on a self-parent cycle instead of looping forever", () => {
  // Bypass the route guard by writing a self-referential row directly, as corrupt/legacy data would.
  insertNode(makeNode({ id: "cycle-self", parent_id: "cycle-self" }), { normalizedSubject: "x" });
  assert.deepEqual(getHistory("cycle-self"), []);
});

test("getHistory terminates on a two-node cycle instead of looping forever", () => {
  insertNode(makeNode({ id: "cycle-a", parent_id: "cycle-b" }), { normalizedSubject: "x" });
  insertNode(makeNode({ id: "cycle-b", parent_id: "cycle-a" }), { normalizedSubject: "x" });
  // Whichever end we start from, the walk visits the other node once and stops at the repeat.
  assert.deepEqual(
    getHistory("cycle-a").map((n) => n.id),
    ["cycle-b"],
  );
});

// The variant handler awaits a slow image generation between reading a node and writing the merged
// blob back, so two concurrent requests for different ratios must not clobber each other. Each write
// re-reads the current persisted variants, so both survive regardless of interleaving.
test("addImageVariant merges into the latest persisted variants, not a stale snapshot", () => {
  insertNode(makeNode({ id: "variant-node", image_variants: { "16:9": "/img/16x9.jpg" } }), {
    normalizedSubject: "x",
  });

  // Simulate the two handlers reading the same original node, then writing at different times.
  const afterFirst = addImageVariant("variant-node", "3:4", "/img/3x4.jpg");
  assert.deepEqual(afterFirst?.image_variants, { "16:9": "/img/16x9.jpg", "3:4": "/img/3x4.jpg" });

  const afterSecond = addImageVariant("variant-node", "1:1", "/img/1x1.jpg");
  // The 3:4 variant added by the first call is preserved, not overwritten by a stale base.
  assert.deepEqual(afterSecond?.image_variants, {
    "16:9": "/img/16x9.jpg",
    "3:4": "/img/3x4.jpg",
    "1:1": "/img/1x1.jpg",
  });
  assert.equal(getNode("variant-node")?.image_variants["3:4"], "/img/3x4.jpg");
});

test("addImageVariant returns null for a node that doesn't exist", () => {
  assert.equal(addImageVariant("no-such-node", "1:1", "/img/x.jpg"), null);
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
