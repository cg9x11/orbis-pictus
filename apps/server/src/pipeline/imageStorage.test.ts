import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { downscaleForStorage, saveImageVariantResized, loadImageAsDataUrl, TARGET_SIZE_BY_ASPECT } from "./imageStorage.js";

/** A real, decodable JPEG at the provider's output size for the given ratio. */
async function providerSizedJpeg(aspectRatio: "16:9" | "3:4" | "1:1"): Promise<Buffer> {
  const dims: Record<"16:9" | "3:4" | "1:1", [number, number]> = {
    "16:9": [2560, 1440],
    "3:4": [1665, 2220],
    "1:1": [1920, 1920],
  };
  const [width, height] = dims[aspectRatio];
  // Raw pixel buffer -> JPEG, so the fixture is a genuinely decodable image without relying on
  // sharp's create-image overload (whose typings vary across versions).
  const raw = Buffer.alloc(width * height * 3, 128);
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg().toBuffer();
}

for (const ratio of ["16:9", "3:4", "1:1"] as const) {
  test(`downscaleForStorage resizes a ${ratio} page down to the storage tier`, async () => {
    const original = await providerSizedJpeg(ratio);
    const out = await downscaleForStorage(original, ratio, "image/jpeg");

    const meta = await sharp(out.bytes).metadata();
    assert.equal(meta.width, TARGET_SIZE_BY_ASPECT[ratio].width);
    assert.equal(meta.height, TARGET_SIZE_BY_ASPECT[ratio].height);
    assert.equal(out.contentType, "image/jpeg");
    assert.ok(out.bytes.length < original.length, "downscaled bytes should be smaller than the provider output");
  });
}

// A resize must never fail a generation that already cost an API call: anything sharp can't decode
// (test fixtures, an unexpected provider payload) is written through unchanged.
test("downscaleForStorage passes non-image bytes through unchanged", async () => {
  const junk = Buffer.from("not-an-image");
  const out = await downscaleForStorage(junk, "16:9", "image/jpeg");
  assert.equal(out.bytes, junk);
  assert.equal(out.contentType, "image/jpeg");
});

test("saveImageVariantResized writes a storage-tier file to disk", async () => {
  const imagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbis-imgstore-"));
  const original = await providerSizedJpeg("16:9");
  const url = await saveImageVariantResized(imagesDir, "node-abc", "16:9", original, "image/jpeg");

  assert.equal(url, "/images/node-abc/landscape.jpg");
  const dataUrl = loadImageAsDataUrl(imagesDir, url);
  const savedBytes = Buffer.from(dataUrl.split(",")[1]!, "base64");
  const meta = await sharp(savedBytes).metadata();
  assert.equal(meta.width, 1280);
  assert.equal(meta.height, 720);
});
