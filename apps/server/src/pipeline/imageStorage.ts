import fs from "node:fs";
import path from "node:path";
import type { AspectRatio, Node } from "@flipbook/shared";

export const VARIANT_NAME: Record<AspectRatio, string> = {
  "3:4": "portrait",
  "1:1": "square",
  "16:9": "landscape",
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
