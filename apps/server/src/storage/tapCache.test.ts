import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Must be set before ./db.js (imported transitively by tapCache.js) runs its module-level migrate().
process.env.DATABASE_URL = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "orbis-tapcache-")), "test.db");

const { recordTapCache, findTapCacheHit } = await import("./tapCache.js");

test("an exact repeat tap hits the cache", () => {
  recordTapCache("node1", "16:9", 0.5, 0.5, "Pho bowl");
  const hit = findTapCacheHit("node1", "16:9", 0.5, 0.5);
  assert.equal(hit?.subject, "Pho bowl");
});

test("a nearby tap within the marker radius hits via a neighboring cell", () => {
  recordTapCache("node2", "1:1", 0.5, 0.5, "Lotus flower");
  // 0.03 offset is well inside the 1:1 marker radius (8.5% ~= 0.085).
  const hit = findTapCacheHit("node2", "1:1", 0.53, 0.47);
  assert.equal(hit?.subject, "Lotus flower");
});

test("a tap outside the marker radius misses the cache", () => {
  recordTapCache("node3", "1:1", 0.2, 0.2, "Something");
  const hit = findTapCacheHit("node3", "1:1", 0.8, 0.8);
  assert.equal(hit, null);
});

test("cache lookups are isolated per node_id", () => {
  recordTapCache("nodeA", "1:1", 0.5, 0.5, "Subject A");
  const hit = findTapCacheHit("nodeB", "1:1", 0.5, 0.5);
  assert.equal(hit, null);
});

test("cache lookups are isolated per aspect_ratio", () => {
  recordTapCache("nodeC", "1:1", 0.5, 0.5, "Subject C");
  const hit = findTapCacheHit("nodeC", "16:9", 0.5, 0.5);
  assert.equal(hit, null);
});
