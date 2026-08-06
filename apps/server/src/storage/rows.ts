/** Row shape of the `nodes` table (see db.ts for DDL). */
export interface NodeRow {
  id: string;
  parent_id: string | null;
  session_id: string;
  query: string;
  page_title: string;
  image_variants: string; // JSON-encoded Record<AspectRatio, string>
  image_model: string;
  prompt_author_model: string;
  authored_prompt: string;
  created_at: string;
  version: number;
  // Internal cache-layer metadata (PLAN §2.3) — never exposed via the public Node zod schema.
  normalized_subject: string;
  prompt_hash: string | null;
  // Idle-loop video state (PLAN §3 Phase 5). `video_status` IS surfaced on the public Node schema
  // (the client needs to distinguish "a clip is coming" from "none will ever exist"); `video_url`
  // stays internal and is served only by GET /api/nodes/:id/video.
  video_status: string | null;
  video_url: string | null;
  // Transition-morph state (PLAN §3 Phase 5) — both internal; the client learns about a morph only
  // by asking GET /api/nodes/:id/morph, which it does once per navigation and never polls.
  morph_status: string | null;
  morph_url: string | null;
}

/** Row shape of the `tap_cache` table (see db.ts for DDL) — layer 1 of PLAN §2.3. */
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
