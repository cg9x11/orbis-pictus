import "../env.js";
import fs from "node:fs";
import path from "node:path";
import { strConfig } from "../config/index.js";
import { writeReversedMorph } from "../pipeline/morphStorage.js";

/**
 * One-off backfill: writes the reversed copy of every morph already on disk, so stepping back up to
 * a parent replays the transition on pages generated before reverse morphs existed.
 * Without it those pages crossfade back forever — the reverse clip is only written at generation
 * time, and nothing regenerates a morph that is already `ready`.
 *
 * Costs no video quota: each one is a local ffmpeg re-encode of a clip that already exists. Needs
 * ffmpeg on PATH, the same as the live path.
 *
 * Deliberately driven by what is on disk rather than by the nodes table: a reversed clip is served
 * purely on file existence (see getMorphReverseUrl), so the filesystem is the thing that has to end
 * up correct, and a stray morph whose row was lost still gets one.
 *
 *   npm run -w apps/server morph:backfill            # fill in what's missing
 *   npm run -w apps/server morph:backfill -- --force # also redo ones that already have a reverse
 */
const imagesDir = path.resolve(process.cwd(), strConfig("IMAGES_DIR", (c) => c.server?.imagesDir, "./data/images"));
const force = process.argv.includes("--force");

if (!fs.existsSync(imagesDir)) {
  console.error(`No images directory at ${imagesDir} — nothing to do.`);
  process.exit(1);
}

const nodeIds = fs
  .readdirSync(imagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((id) => fs.existsSync(path.join(imagesDir, id, "morph.mp4")));

console.log(`Scanning ${imagesDir}: ${nodeIds.length} node(s) with a morph.\n`);

let written = 0;
let skipped = 0;
let failed = 0;

// Sequential on purpose: `-vf reverse` buffers a whole clip in memory, and a wide backfill would
// otherwise start one ffmpeg per node at once.
for (const id of nodeIds) {
  if (!force && fs.existsSync(path.join(imagesDir, id, "morph-reverse.mp4"))) {
    skipped++;
    continue;
  }
  process.stdout.write(`  ${id} … `);
  const ok = await writeReversedMorph(imagesDir, id);
  if (ok) {
    written++;
    console.log("ok");
  } else {
    failed++;
    // writeReversedMorph already logged why.
  }
}

console.log(`\nDone. ${written} written, ${skipped} already had one, ${failed} failed.`);
if (failed > 0) process.exitCode = 1;
