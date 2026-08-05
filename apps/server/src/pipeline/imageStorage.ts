import fs from "node:fs";
import path from "node:path";
import type { AspectRatio } from "@flipbook/shared";

export const VARIANT_NAME: Record<AspectRatio, string> = {
  "3:4": "portrait",
  "1:1": "square",
  "16:9": "landscape",
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
