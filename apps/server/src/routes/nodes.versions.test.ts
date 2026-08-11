import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Node, VersionSummary } from "@orbis/shared";
import type { Providers } from "../providers/index.js";
import type { VideoPipeline } from "../pipeline/video.js";
import type { MorphPipeline } from "../pipeline/morph.js";

// Set before the storage module is imported: db.ts opens its database at module scope.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbis-versions-"));
process.env.DATABASE_URL = path.join(tmpDir, "test.db");
const imagesDir = path.join(tmpDir, "images");

const { insertNode, insertVersionAsDefault } = await import("../storage/nodes.js");
const { nodesRoute } = await import("./nodes.js");

// These endpoints read/write the database only - no providers or pipelines involved.
const noProviders = () => ({}) as unknown as Providers;
function app() {
  return nodesRoute(noProviders, imagesDir, {} as unknown as VideoPipeline, {} as unknown as MorphPipeline);
}

let counter = 0;
function makeNode(overrides: Partial<Node> = {}): Node {
  counter += 1;
  return {
    id: `v-${counter}`,
    parent_id: null,
    session_id: "session_test",
    query: `topic ${counter}`,
    page_title: `Page ${counter}`,
    image_variants: { "16:9": `/images/v-${counter}/landscape.jpg` },
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

type VersionsBody = { versions: VersionSummary[] };

test("GET /:id/versions lists a group's versions oldest-first, with the default flagged, from either member id", async () => {
  insertNode(makeNode({ id: "ev-day", page_title: "Eiffel Tower", created_at: "2440-01-01T00:00:00.000Z" }), {
    normalizedSubject: "eiffel",
  });
  insertVersionAsDefault(
    makeNode({
      id: "ev-night",
      page_title: "Eiffel Tower",
      image_variants: { "16:9": "/images/ev-night/landscape.jpg" },
      created_at: "2440-01-02T00:00:00.000Z",
      version_group_id: "ev-day",
      edited_from_id: "ev-day",
      edit_command: "make it night time",
    }),
    { normalizedSubject: "eiffel" },
  );

  const res = await app().request("/ev-day/versions");
  assert.equal(res.status, 200);
  const body = (await res.json()) as VersionsBody;

  assert.deepEqual(body.versions.map((v) => v.id), ["ev-day", "ev-night"]); // oldest first
  assert.deepEqual(body.versions.map((v) => v.is_default), [false, true]); // newest edit is the default
  const night = body.versions[1]!;
  assert.equal(night.edit_command, "make it night time");
  assert.equal(night.edited_from_id, "ev-day");
  assert.equal(night.image_url, "/images/ev-night/landscape.jpg"); // representative thumbnail

  // Asking with the OTHER member id resolves to the same group and the same list.
  const res2 = await app().request("/ev-night/versions");
  const body2 = (await res2.json()) as VersionsBody;
  assert.deepEqual(body2.versions.map((v) => v.id), ["ev-day", "ev-night"]);
});

test("GET /:id/versions 404s for an unknown node", async () => {
  const res = await app().request("/no-such-node/versions");
  assert.equal(res.status, 404);
});

test("POST /:id/default moves the default and returns the fresh list with exactly one default", async () => {
  insertNode(makeNode({ id: "sd-day", created_at: "2441-01-01T00:00:00.000Z" }), { normalizedSubject: "sd" });
  insertVersionAsDefault(
    makeNode({ id: "sd-night", created_at: "2441-01-02T00:00:00.000Z", version_group_id: "sd-day", edited_from_id: "sd-day" }),
    { normalizedSubject: "sd" },
  );

  // sd-night is the default now (newest edit). Make sd-day the default.
  const res = await app().request("/sd-day/default", { method: "POST" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as VersionsBody;

  const byId = Object.fromEntries(body.versions.map((v) => [v.id, v.is_default]));
  assert.equal(byId["sd-day"], true);
  assert.equal(byId["sd-night"], false);
  assert.equal(body.versions.filter((v) => v.is_default).length, 1);
});

test("POST /:id/default 404s for an unknown node", async () => {
  const res = await app().request("/no-such-node/default", { method: "POST" });
  assert.equal(res.status, 404);
});

test("GET /api/nodes reports version_counts per card, keyed by the card's node id", async () => {
  // A group with two versions (one gallery card = the default), plus a singleton page.
  insertNode(makeNode({ id: "vc-day", parent_id: null, created_at: "2442-01-01T00:00:00.000Z" }), { normalizedSubject: "vc" });
  insertVersionAsDefault(
    makeNode({ id: "vc-night", parent_id: null, created_at: "2442-01-02T00:00:00.000Z", version_group_id: "vc-day", edited_from_id: "vc-day" }),
    { normalizedSubject: "vc" },
  );
  insertNode(makeNode({ id: "vc-solo", parent_id: null, created_at: "2442-01-03T00:00:00.000Z" }), { normalizedSubject: "vc-solo" });

  const res = await app().request("/?limit=all");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { nodes: Node[]; version_counts: Record<string, number> };

  // The card for the group is its default version (vc-night), and its count is 2. The singleton is 1.
  assert.equal(body.version_counts["vc-night"], 2);
  assert.equal(body.version_counts["vc-solo"], 1);
  // vc-day is demoted, so it is not a card and gets no count.
  assert.ok(body.nodes.some((n) => n.id === "vc-night"));
  assert.ok(!body.nodes.some((n) => n.id === "vc-day"));
});
