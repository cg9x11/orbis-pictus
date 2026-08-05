import type { AspectRatio } from "@flipbook/shared";
import { db } from "./db.js";
import type { TapCacheRow } from "./schema.js";
import { tapCellIndex, isWithinTapRadius } from "../pipeline/tapMath.js";

const insertStmt = db.prepare(`
  INSERT INTO tap_cache (node_id, cell_x, cell_y, x, y, subject, aspect_ratio, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

/** Records a resolved tap so future taps on the same node near this point skip the VLM call. */
export function recordTapCache(nodeId: string, aspectRatio: AspectRatio, x: number, y: number, subject: string): void {
  insertStmt.run(nodeId, tapCellIndex(x), tapCellIndex(y), x, y, subject, aspectRatio, new Date().toISOString());
}

// Candidates from the tapped cell and its 8 neighbors (cell ± 1 on each axis), scoped to the
// same node + aspect ratio (the marker geometry depends on aspect ratio — PLAN §2.3).
const candidatesStmt = db.prepare(`
  SELECT * FROM tap_cache
  WHERE node_id = ? AND aspect_ratio = ?
    AND cell_x BETWEEN ? AND ? AND cell_y BETWEEN ? AND ?
  ORDER BY created_at ASC
`);

export function findTapCacheHit(
  nodeId: string,
  aspectRatio: AspectRatio,
  x: number,
  y: number,
): { subject: string } | null {
  const cx = tapCellIndex(x);
  const cy = tapCellIndex(y);
  const rows = candidatesStmt.all(nodeId, aspectRatio, cx - 1, cx + 1, cy - 1, cy + 1) as unknown as TapCacheRow[];
  const hit = rows.find((row) => isWithinTapRadius(aspectRatio, row.x, row.y, x, y));
  return hit ? { subject: hit.subject } : null;
}
