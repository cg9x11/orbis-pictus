import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Node } from "@orbis/shared";
import type { Providers } from "../providers/index.js";
import type { VideoPipeline } from "../pipeline/video.js";
import type { MorphPipeline } from "../pipeline/morph.js";

// Set before the storage module is imported: db.ts opens its database at module scope.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbis-list-"));
process.env.DATABASE_URL = path.join(tmpDir, "test.db");
const imagesDir = path.join(tmpDir, "images");

const { insertNode } = await import("../storage/nodes.js");
const { nodesRoute } = await import("./nodes.js");

/** The gallery listing reads the database only, so it touches neither providers nor pipelines. */
const noProviders = () => ({}) as unknown as Providers;
const noPipelines = {
  video: {} as unknown as VideoPipeline,
  morph: {} as unknown as MorphPipeline,
};

function app() {
  return nodesRoute(noProviders, imagesDir, noPipelines.video, noPipelines.morph);
}

let counter = 0;
function makeNode(overrides: Partial<Node> = {}): Node {
  counter += 1;
  return {
    id: `list-${counter}`,
    parent_id: null,
    session_id: "session_test",
    query: `topic ${counter}`,
    page_title: `Page ${counter}`,
    image_variants: { "16:9": `/images/list-${counter}/landscape.jpg` },
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

/**
 * Seeds `count` roots dated inside `year`, and returns their ids newest first — the order the
 * gallery must produce.
 *
 * Every test in this file shares one database. Each caller therefore gets its own year, so that
 * one test's fixtures never interleave with another's and shift the expected page boundaries.
 */
function seedRoots(prefix: string, count: number, year: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = `${prefix}-${i}`;
    const day = String(i + 1).padStart(2, "0");
    insertNode(makeNode({ id, created_at: `${year}-01-${day}T00:00:00.000Z` }), {
      normalizedSubject: prefix,
    });
    ids.push(id);
  }
  return ids.reverse();
}

type ListBody = { nodes: Node[]; next_cursor: string | null };

test("GET /api/nodes names the cursor field next_cursor and pages through with no repeats", async () => {
  // The highest year in this file, so these rows sit at the top of the gallery whatever else the
  // other tests have seeded by the time this one runs.
  const newestFirst = seedRoots("page", 5, 2440);

  const first = await app().request("/?limit=2");
  assert.equal(first.status, 200);
  const firstBody = (await first.json()) as ListBody;
  // The field name is part of the wire contract the client reads. A rename breaks "Load more"
  // silently, because a missing field reads as "no further pages" rather than as an error.
  assert.ok("next_cursor" in firstBody);
  assert.equal(typeof firstBody.next_cursor, "string");
  assert.deepEqual(firstBody.nodes.map((n) => n.id), newestFirst.slice(0, 2));

  const second = await app().request(`/?limit=2&cursor=${encodeURIComponent(firstBody.next_cursor!)}`);
  assert.equal(second.status, 200);
  const secondBody = (await second.json()) as ListBody;
  assert.deepEqual(secondBody.nodes.map((n) => n.id), newestFirst.slice(2, 4));

  const seen = [...firstBody.nodes, ...secondBody.nodes].map((n) => n.id);
  assert.equal(new Set(seen).size, seen.length, "no card is served twice");
});

test("GET /api/nodes rejects a malformed cursor with 400 instead of serving the first page", async () => {
  seedRoots("bad", 3, 2430);

  // "zzz" is the dangerous case, not merely an invalid one. The seek compares the cursor against
  // created_at as text, every real timestamp starts with a digit, and digits sort below "z". An
  // unvalidated "zzz" therefore matches every root and returns the whole gallery as page two.
  for (const cursor of ["zzz|x", "no-separator", "|missing-timestamp", "2026-01-01T00:00:00.000Z|", "2026-13-45T99:99:99.999Z|x"]) {
    const res = await app().request(`/?limit=2&cursor=${encodeURIComponent(cursor)}`);
    assert.equal(res.status, 400, `cursor ${cursor} must be rejected`);
    const body = (await res.json()) as { error?: string };
    assert.equal(body.error, "Invalid cursor");
  }
});

test("GET /api/nodes returns cards for a fractional limit rather than an empty gallery", async () => {
  seedRoots("frac", 3, 2420);

  // 0.5 is greater than zero, so it passes the positive check and then floors to 0. Without a
  // lower bound that reaches SQLite as LIMIT 0: an empty list, status 200, and a client that
  // renders "no pages yet" against a full database.
  const res = await app().request("/?limit=0.5");
  assert.equal(res.status, 200);
  const body = (await res.json()) as ListBody;
  assert.ok(body.nodes.length >= 1, "a fractional limit must still return at least one card");
});

test("GET /api/nodes reports next_cursor null once the last page is served", async () => {
  const res = await app().request("/?limit=all");
  assert.equal(res.status, 200);
  const body = (await res.json()) as ListBody;
  assert.equal(body.next_cursor, null);
  assert.ok(body.nodes.length > 0);
});
