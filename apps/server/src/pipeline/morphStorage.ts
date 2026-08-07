import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REVERSE_FILENAME = "morph-reverse.mp4";

/** Writes a generated transition-morph clip to disk beside the child node's own images and
 *  returns its same-origin URL (PLAN §3 Phase 5) — same storage/serving pattern as videoStorage.ts. */
export function saveMorph(imagesDir: string, childNodeId: string, bytes: Buffer): string {
  const nodeDir = path.join(imagesDir, childNodeId);
  fs.mkdirSync(nodeDir, { recursive: true });
  fs.writeFileSync(path.join(nodeDir, "morph.mp4"), bytes);
  return `/images/${childNodeId}/morph.mp4`;
}

/**
 * Re-encodes a saved morph backwards, so stepping back from a child to its parent can play the same
 * transition in reverse (PLAN §3 Phase 5). A morph is a first-frame/last-frame interpolation from
 * the parent's image to the child's, so its reverse is exactly the parent-ward transition — no
 * second video generation, and no video quota, just a re-encode.
 *
 * Runs ffmpeg from PATH and resolves false if it is missing or fails: the reversed clip is strictly
 * additive, and the client falls back to its crossfade when there isn't one. That keeps ffmpeg an
 * optional local tool rather than a hard dependency of the server.
 *
 * `-vf reverse` buffers the whole clip in memory, which is fine only because these are a few seconds
 * at 480p; it must never be pointed at long video. `-an` drops audio (morphs are silent) so no
 * matching `-af areverse` is needed.
 */
export function writeReversedMorph(imagesDir: string, childNodeId: string): Promise<boolean> {
  const nodeDir = path.join(imagesDir, childNodeId);
  const input = path.join(nodeDir, "morph.mp4");
  const output = path.join(nodeDir, REVERSE_FILENAME);

  return new Promise((resolve) => {
    const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-i", input, "-vf", "reverse", "-an", output], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    ff.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    ff.on("error", (err) => {
      console.warn(`[flipbook] reverse morph unavailable for ${childNodeId} (ffmpeg not runnable):`, err.message);
      resolve(false);
    });
    ff.on("close", (code) => {
      if (code === 0 && fs.existsSync(output)) return resolve(true);
      console.warn(`[flipbook] reverse morph failed for ${childNodeId} (ffmpeg exit ${code}):`, stderr.trim());
      // A half-written file would be served as a broken clip, so drop it and let the crossfade run.
      fs.rmSync(output, { force: true });
      resolve(false);
    });
  });
}

/** The reversed clip's URL if one was successfully written, else null — the path is derivable from
 *  the node id, so its existence on disk is the single source of truth and needs no DB column. */
export function getMorphReverseUrl(imagesDir: string, childNodeId: string): string | null {
  return fs.existsSync(path.join(imagesDir, childNodeId, REVERSE_FILENAME))
    ? `/images/${childNodeId}/${REVERSE_FILENAME}`
    : null;
}
