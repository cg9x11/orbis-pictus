import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Node } from "@flipbook/shared";
import type { ImageGenInput, ImageGenResult, ImageProvider, SearchProvider } from "../providers/types.js";

// Must be set before ./generate.js (imports storage/nodes.js -> storage/db.js) runs its
// module-level migrate(), same pattern as storage/nodes.test.ts.
process.env.DATABASE_URL = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "flipbook-generate-")), "test.db");

const { runGenerate } = await import("./generate.js");
const { getHouseStyleBlock } = await import("./houseStyle.js");
const { saveImageVariant } = await import("./imageStorage.js");
const { insertNode } = await import("../storage/nodes.js");
const { MockLlmProvider } = await import("../providers/llm/mock.js");
const { MockVideoProvider } = await import("../providers/video/mock.js");

class SpyImageProvider implements ImageProvider {
  readonly modelId = "spy-image";
  readonly providerId = "spy";
  lastInput: ImageGenInput | undefined;

  async generate(input: ImageGenInput): Promise<ImageGenResult> {
    this.lastInput = input;
    return { bytes: Buffer.from("fake-image-bytes"), contentType: "image/jpeg" };
  }
}

const noSearch: SearchProvider = { available: false, search: async () => null };

function makeContext(image: ImageProvider) {
  return {
    providers: { llm: new MockLlmProvider(), image, video: new MockVideoProvider(), search: noSearch },
    imagesDir: fs.mkdtempSync(path.join(os.tmpdir(), "flipbook-images-")),
  };
}

test("search mode: the built image prompt includes the house style, authored_prompt does not", async () => {
  const image = new SpyImageProvider();
  const node = await runGenerate(
    { mode: "search", query: "Ha Noi street food", aspect_ratio: "16:9", web_search: false, session_id: "s1", current_node_id: "" },
    makeContext(image),
    () => {},
  );

  const houseStyle = getHouseStyleBlock();
  assert.ok(image.lastInput?.prompt.includes(houseStyle), "image prompt sent to the provider should include the house style block");
  assert.ok(!node.authored_prompt.includes(houseStyle), "stored authored_prompt (content-only) should not include the house style block");
});

test("edit mode: the built image prompt includes the house style and passes the current image as reference", async () => {
  const ctx = makeContext(new SpyImageProvider());
  const parentImageBytes = Buffer.from("parent-page-pixels");
  const parentImageUrl = saveImageVariant(ctx.imagesDir, "parent-edit", "16:9", parentImageBytes, "image/jpeg");
  const parent: Node = {
    id: "parent-edit",
    parent_id: null,
    session_id: "s1",
    query: "Ha Noi street food",
    page_title: "Ha Noi Street Food",
    image_variants: { "16:9": parentImageUrl },
    image_model: "mock-image",
    prompt_author_model: "mock-llm",
    authored_prompt: "content prompt for the parent page",
    created_at: new Date().toISOString(),
    version: 1,
  };
  insertNode(parent, { normalizedSubject: "root" });

  const currentImageDataUrl = `data:image/jpeg;base64,${Buffer.from("current-page-pixels").toString("base64")}`;
  const image = ctx.providers.image as SpyImageProvider;
  const node = await runGenerate(
    {
      mode: "edit",
      prompt: "make it night time",
      image: currentImageDataUrl,
      aspect_ratio: "16:9",
      web_search: false,
      parent_query: "Ha Noi street food",
      parent_title: "Ha Noi Street Food",
      session_id: "s1",
      current_node_id: "parent-edit",
    },
    ctx,
    () => {},
  );

  const houseStyle = getHouseStyleBlock();
  assert.ok(image.lastInput?.prompt.includes(houseStyle));
  assert.ok(!node.authored_prompt.includes(houseStyle));
  assert.equal(image.lastInput?.referenceImageDataUrl, currentImageDataUrl);
});

test("tap mode: the built image prompt includes the house style and reuses the parent page image as reference", async () => {
  const ctx = makeContext(new SpyImageProvider());
  const parentImageBytes = Buffer.from("parent-page-pixels-for-tap");
  const parentImageUrl = saveImageVariant(ctx.imagesDir, "parent-tap", "16:9", parentImageBytes, "image/jpeg");
  const parent: Node = {
    id: "parent-tap",
    parent_id: null,
    session_id: "s1",
    query: "Ha Noi street food",
    page_title: "Ha Noi Street Food",
    image_variants: { "16:9": parentImageUrl },
    image_model: "mock-image",
    prompt_author_model: "mock-llm",
    authored_prompt: "content prompt for the parent page",
    created_at: new Date().toISOString(),
    version: 1,
  };
  insertNode(parent, { normalizedSubject: "root" });

  const markedImageDataUrl = `data:image/jpeg;base64,${Buffer.from("marked-with-tap-circle").toString("base64")}`;
  const image = ctx.providers.image as SpyImageProvider;
  const node = await runGenerate(
    {
      mode: "tap",
      image: markedImageDataUrl,
      x: 0.5,
      y: 0.5,
      aspect_ratio: "16:9",
      web_search: false,
      parent_query: "Ha Noi street food",
      parent_title: "Ha Noi Street Food",
      session_id: "s1",
      current_node_id: "parent-tap",
    },
    ctx,
    () => {},
  );

  const houseStyle = getHouseStyleBlock();
  assert.ok(image.lastInput?.prompt.includes(houseStyle));
  assert.ok(!node.authored_prompt.includes(houseStyle));

  // The reference image must be the parent's own stored page image, not the marked tap image.
  const expectedReference = `data:image/jpeg;base64,${parentImageBytes.toString("base64")}`;
  assert.equal(image.lastInput?.referenceImageDataUrl, expectedReference);
  assert.notEqual(image.lastInput?.referenceImageDataUrl, markedImageDataUrl);
});
