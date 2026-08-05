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
}
