import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { AspectRatio, Node } from "@flipbook/shared";

export const VARIANT_NAME: Record<AspectRatio, string> = {
  "3:4": "portrait",
  "1:1": "square",
  "16:9": "landscape",
};

/**
 * Storage-tier dimensions (PLAN §1.3's original draft sizes). The image provider is forced to
 * render at BytePlus Ark's ~3.69 MP floor (see providers/image/ark.ts), but we don't need to keep
 * that on disk: every downstream consumer is fine at these smaller sizes — the page view, the
 * image-to-video reference frame (video is generated at 480p by default, ≤1080p, so a 1280x720
 * frame meets or exceeds the output), and the image-to-image tap/edit reference (which only
 * conditions composition, and is regenerated at the floor regardless). Storing these instead cuts
 * on-disk bytes and page-load weight by ~75%. The aspect ratios match the provider's output
 * exactly, so this is a straight downscale with no crop for generated pages.
 */
export const TARGET_SIZE_BY_ASPECT: Record<AspectRatio, { width: number; height: number }> = {
  "16:9": { width: 1280, height: 720 },
  "3:4": { width: 960, height: 1280 },
  "1:1": { width: 960, height: 960 },
};

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export function extFromContentType(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  return "jpg";
}

/** Writes generated/uploaded image bytes to disk and returns the same-origin URL to serve it at. */
export function saveImageVariant(
  imagesDir: string,
  nodeId: string,
  aspectRatio: AspectRatio,
  bytes: Buffer,
  contentType: string,
): string {
  const variant = VARIANT_NAME[aspectRatio];
  const ext = extFromContentType(contentType);
  const nodeDir = path.join(imagesDir, nodeId);
  fs.mkdirSync(nodeDir, { recursive: true });
  fs.writeFileSync(path.join(nodeDir, `${variant}.${ext}`), bytes);
  return `/images/${nodeId}/${variant}.${ext}`;
}

/**
 * Downscales generated/uploaded image bytes to the storage tier (TARGET_SIZE_BY_ASPECT) and
 * re-encodes as JPEG. `fit: "cover"` is a pure downscale when the input already matches the aspect
 * ratio (every generated page) and a centre-crop when it does not (an uploaded photo of some other
 * shape); `withoutEnlargement` means a smaller-than-target input is left as-is rather than blown up.
 *
 * Best-effort by design: anything sharp can't decode (e.g. test fixtures that pass non-image bytes,
 * or an unexpected provider payload) is written through unchanged rather than throwing — a resize
 * must never be able to fail a generation that has already cost an API call.
 */
export async function downscaleForStorage(
  bytes: Buffer,
  aspectRatio: AspectRatio,
  contentType: string,
): Promise<{ bytes: Buffer; contentType: string }> {
  const target = TARGET_SIZE_BY_ASPECT[aspectRatio];
  try {
    const resized = await sharp(bytes)
      .resize(target.width, target.height, { fit: "cover", position: "centre", withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
    return { bytes: resized, contentType: "image/jpeg" };
  } catch (err) {
    console.warn(
      `[flipbook] image downscale skipped for ${aspectRatio}, storing original bytes:`,
      err instanceof Error ? err.message : err,
    );
    return { bytes, contentType };
  }
}

/**
 * Downscale-then-save: the production path always wants the storage-tier variant, never the
 * full ~3.69 MP provider output. `saveImageVariant` stays a dumb byte-writer (tests write fixtures
 * through it directly); this is the wrapper real generations and uploads go through.
 */
export async function saveImageVariantResized(
  imagesDir: string,
  nodeId: string,
  aspectRatio: AspectRatio,
  bytes: Buffer,
  contentType: string,
): Promise<string> {
  const out = await downscaleForStorage(bytes, aspectRatio, contentType);
  return saveImageVariant(imagesDir, nodeId, aspectRatio, out.bytes, out.contentType);
}

/** Reads a same-origin image URL (as returned by saveImageVariant, e.g. "/images/{nodeId}/landscape.jpg") back off disk as a data: URL. */
export function loadImageAsDataUrl(imagesDir: string, imageUrl: string): string {
  const relative = imageUrl.replace(/^\/images\//, "");
  const bytes = fs.readFileSync(path.join(imagesDir, relative));
  const ext = path.extname(relative).slice(1).toLowerCase();
  const mimeType = MIME_BY_EXT[ext] ?? "image/jpeg";
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

/**
 * A node's image for the requested aspect ratio, falling back to whichever variant it does have
 * (e.g. a tap on a page whose only stored variant is a different ratio) — used for tap-mode scene
 * continuity (PLAN §4: pass the parent page image as ImageGenInput.referenceImageDataUrl).
 */
export function loadReferenceImageDataUrl(imagesDir: string, node: Node, aspectRatio: AspectRatio): string | undefined {
  const url = node.image_variants[aspectRatio] ?? Object.values(node.image_variants).find((v): v is string => Boolean(v));
  return url ? loadImageAsDataUrl(imagesDir, url) : undefined;
}
