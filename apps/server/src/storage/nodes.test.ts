import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Node } from "@flipbook/shared";

process.env.DATABASE_URL = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "flipbook-nodes-")), "test.db");

const { insertNode, findChildBySubject, findNodeByPromptHash, listGalleryNodes } = await import("./nodes.js");

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
