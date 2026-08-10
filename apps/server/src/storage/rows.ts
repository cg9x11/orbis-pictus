import type { Node } from "@orbis/shared";

/** Row shape of the `nodes` table (see db.ts for DDL). Derived from the public Node type so a
 *  field rename/add there is caught here at compile time. Only image_variants, video_status, and
 *  morph_status differ in shape — SQLite has no object or enum column type, so all three are
 *  stored as raw TEXT and only take their Node-facing shape once parsed/validated in nodes.ts
 *  (ImageVariantsSchema.parse, toVideoStatus(), toMorphStatus()) — plus video_url/morph_url, never
 *  exposed via NodeSchema at all. */
export interface NodeRow
  extends Omit<
    Node,
    | "image_variants"
    | "video_status"
    | "morph_status"
    | "is_default"
    | "version_group_id"
    | "edited_from_id"
    | "edit_command"
    | "tap_x"
    | "tap_y"
  > {
  image_variants: string; // JSON-encoded ImageVariants
  // Page versions. `is_default` is 0/1 in SQLite (no boolean column type), narrowed to a boolean in
  // rowToNode. `version_group_id` is nullable at the SQL level (see db.ts) but always populated after
  // the backfill; rowToNode reads a null as the row's own id.
  version_group_id: string | null;
  edited_from_id: string | null;
  edit_command: string | null;
  is_default: number;
  // Tap origin on the parent, normalized 0..1. Null for roots, edits, cached-tap opens, and legacy
  // rows; rowToNode maps null to undefined. REAL columns, so they come back as numbers.
  tap_x: number | null;
  tap_y: number | null;
  // Internal cache-layer metadata — never exposed via the public Node zod schema.
  normalized_subject: string;
  prompt_hash: string | null;
  // Idle-loop video state. `video_status` IS surfaced on the public Node schema
  // (the client needs to distinguish "a clip is coming" from "none will ever exist"); `video_url`
  // stays internal and is served only by GET /api/nodes/:id/video.
  video_status: string | null;
  video_url: string | null;
  // Transition-morph state. `morph_status` is now also on the public Node schema
  // (same rationale as video_status); `morph_url` stays internal, served only by
  // GET /api/nodes/:id/morph.
  morph_status: string | null;
  morph_url: string | null;
}

/** Row shape of the `tap_cache` table (see db.ts for DDL) — layer 1 of the cache. */
export interface TapCacheRow {
  id: number;
  node_id: string;
  cell_x: number;
  cell_y: number;
  x: number;
  y: number;
  subject: string;
  aspect_ratio: string;
  created_at: string;
}
