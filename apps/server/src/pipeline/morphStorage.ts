import fs from "node:fs";
import path from "node:path";

/** Writes a generated transition-morph clip to disk beside the child node's own images and
 *  returns its same-origin URL (PLAN §3 Phase 5) — same storage/serving pattern as videoStorage.ts. */
export function saveMorph(imagesDir: string, childNodeId: string, bytes: Buffer): string {
  const nodeDir = path.join(imagesDir, childNodeId);
  fs.mkdirSync(nodeDir, { recursive: true });
  fs.writeFileSync(path.join(nodeDir, "morph.mp4"), bytes);
  return `/images/${childNodeId}/morph.mp4`;
}
