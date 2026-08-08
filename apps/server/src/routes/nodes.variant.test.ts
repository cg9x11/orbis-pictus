import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Node } from "@flipbook/shared";
import { UnknownModelError, type ImageProvider } from "../providers/types.js";
import type { Providers, ProviderOverrides } from "../providers/index.js";
import type { VideoPipeline } from "../pipeline/video.js";
import type { MorphPipeline } from "../pipeline/morph.js";

// Set before the storage module is imported: db.ts opens its database at module scope.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "flipbook-variant-"));
process.env.DATABASE_URL = path.join(tmpDir, "test.db");
const imagesDir = path.join(tmpDir, "images");

const { insertNode } = await import("../storage/nodes.js");
const { nodesRoute } = await import("./nodes.js");

let counter = 0;
function makeNode(overrides: Partial<Node> = {}): Node {
  counter += 1;
  return {
    id: `variant-${counter}`,
    parent_id: null,
    session_id: "session_test",
    query: `topic ${counter}`,
    page_title: `Page ${counter}`,
    // Deliberately 16:9 only, so a request for another ratio has to draw.
    image_variants: { "16:9": `/images/variant-${counter}/landscape.jpg` },
    image_model: "",
    image_provider: "",
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

interface Drawn {
  modelId: string;
}

/**
 * An image provider that either draws or refuses, and records every attempt.
 *
 * `rejects` names the model ids the provider does not recognise, which is how a model id retired
 * by the provider AFTER a page was drawn is reproduced.
 */
function stubProvider(modelId: string, drawn: Drawn[], rejects: string[] = []): ImageProvider {
  return {
    providerId: "ark",
    modelId,
    generate: async () => {
      drawn.push({ modelId });
      if (rejects.includes(modelId)) throw new UnknownModelError(`no such model "${modelId}"`);
      return { bytes: Buffer.from(`drawn-by-${modelId}`), contentType: "image/jpeg" };
    },
  };
}

/** The variant route touches neither pipeline, so a cast beats stubbing two wide interfaces. */
const noPipelines = {
  video: {} as unknown as VideoPipeline,
  morph: {} as unknown as MorphPipeline,
};

test("variant: a stored model the provider has since retired falls back instead of 500ing", async () => {
  const node = makeNode({ image_provider: "ark", image_model: "retired-model" });
  insertNode(node, { normalizedSubject: `subj-${node.id}` });

  const drawn: Drawn[] = [];
  const resolveProviders = (o: ProviderOverrides = {}): Providers =>
    ({ image: stubProvider(o.imageModel ?? "configured-model", drawn, ["retired-model"]) }) as unknown as Providers;

  const app = nodesRoute(resolveProviders, imagesDir, noPipelines.video, noPipelines.morph);
  const res = await app.request(`/${node.id}/variant?ratio=1:1`);

  // The regression: unwrapped, UnknownModelError escaped a plain GET and the page 500'd — a page
  // that had rendered fine before provenance was ever recorded.
  assert.equal(res.status, 200);
  const body = (await res.json()) as { node: Node };
  assert.ok(body.node.image_variants["1:1"], "the variant must have been created and stored");

  assert.deepEqual(
    drawn.map((d) => d.modelId),
    ["retired-model", "configured-model"],
    "the stored model is tried first, then the server's configured default",
  );
});

test("variant: a node with no stored provenance draws once, with no fallback wrapper", async () => {
  const node = makeNode();
  insertNode(node, { normalizedSubject: `subj-${node.id}` });

  const drawn: Drawn[] = [];
  const resolveProviders = (o: ProviderOverrides = {}): Providers =>
    ({ image: stubProvider(o.imageModel ?? "configured-model", drawn) }) as unknown as Providers;

  const app = nodesRoute(resolveProviders, imagesDir, noPipelines.video, noPipelines.morph);
  const res = await app.request(`/${node.id}/variant?ratio=3:4`);

  assert.equal(res.status, 200);
  // With no model named there is nothing to fall back FROM, so the wrapper must not be built at all.
  assert.deepEqual(
    drawn.map((d) => d.modelId),
    ["configured-model"],
  );
});
