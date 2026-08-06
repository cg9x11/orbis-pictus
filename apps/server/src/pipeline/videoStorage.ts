import fs from "node:fs";
import path from "node:path";

/** Writes a generated idle-loop clip to disk beside the page's images and returns its same-origin URL (PLAN §3 Phase 5). */
export function saveVideo(imagesDir: string, nodeId: string, bytes: Buffer): string {
  const nodeDir = path.join(imagesDir, nodeId);
  fs.mkdirSync(nodeDir, { recursive: true });
  fs.writeFileSync(path.join(nodeDir, "loop.mp4"), bytes);
  return `/images/${nodeId}/loop.mp4`;
}
