import type { Node } from "@flipbook/shared";

/** Row shape of the `nodes` table (see db.ts for DDL). Derived from the public Node type so a
 *  field rename/add there is caught here at compile time. Only image_variants, video_status, and
 *  morph_status differ in shape — SQLite has no object or enum column type, so all three are
 *  stored as raw TEXT and only take their Node-facing shape once parsed/validated in nodes.ts
 *  (ImageVariantsSchema.parse, toVideoStatus(), toMorphStatus()) — plus video_url/morph_url, never
 *  exposed via NodeSchema at all. */
export interface NodeRow extends Omit<Node, "image_variants" | "video_status" | "morph_status"> {
  image_variants: string; // JSON-encoded ImageVariants
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
