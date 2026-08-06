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
  // Internal idle-loop video state (PLAN §3 Phase 5) — never exposed via the public Node zod
  // schema either; read only through storage/nodes.ts's dedicated video helpers.
  video_status: string | null;
  video_url: string | null;
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
