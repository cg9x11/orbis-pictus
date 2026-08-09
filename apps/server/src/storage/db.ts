import "../env.js";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { strConfig } from "../config/index.js";

const dbPath = strConfig("DATABASE_URL", (c) => c.server?.databaseUrl, "./data/orbis.db");
fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL;");

/** Adds a column to an existing table if it isn't already there. SQLite has no
 *  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so this checks PRAGMA table_info first —
 *  needed because dev databases created before Phase 3 lack the cache-layer columns.
 *
 *  `table`/`column`/`columnDdl` are interpolated directly into SQL text because SQLite can't bind
 *  identifiers as query parameters — only values. This is safe only because every call site below
 *  passes a hardcoded literal; never pass a request-derived string here. */
function ensureColumn(table: string, column: string, columnDdl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDdl}`);
  }
}

export function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      session_id TEXT NOT NULL,
      query TEXT NOT NULL,
      page_title TEXT NOT NULL,
      image_variants TEXT NOT NULL,
      image_model TEXT NOT NULL,
      prompt_author_model TEXT NOT NULL,
      authored_prompt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS nodes_parent_id_idx ON nodes(parent_id);
    CREATE INDEX IF NOT EXISTS nodes_session_id_idx ON nodes(session_id);
  `);

  // Subject-level child dedup + prompt-hash image cache.
  ensureColumn("nodes", "normalized_subject", "normalized_subject TEXT NOT NULL DEFAULT ''");
  ensureColumn("nodes", "prompt_hash", "prompt_hash TEXT");
  db.exec(`
    CREATE INDEX IF NOT EXISTS nodes_parent_subject_idx ON nodes(parent_id, normalized_subject);
    CREATE INDEX IF NOT EXISTS nodes_prompt_hash_idx ON nodes(prompt_hash);
  `);

  // Landing-gallery keyset pagination, original form. The gallery now filters on `is_default = 1` as
  // well as `parent_id IS NULL`, and reads through the partial `nodes_default_root_idx` created in
  // the page-versions block below. This index no longer matches the gallery query column for column,
  // but it is kept (not dropped) because a bare `parent_id`-prefixed index is cheap and a future
  // parent-scan query may want it. See plans/PLAN-versions.md, finding 12.
  db.exec(`
    CREATE INDEX IF NOT EXISTS nodes_root_created_idx
      ON nodes(parent_id, created_at DESC, id DESC);
  `);

  // Coordinate-quantization VLM cache.
  db.exec(`
    CREATE TABLE IF NOT EXISTS tap_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_id TEXT NOT NULL,
      cell_x INTEGER NOT NULL,
      cell_y INTEGER NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      subject TEXT NOT NULL,
      aspect_ratio TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tap_cache_node_cell_idx ON tap_cache(node_id, aspect_ratio, cell_x, cell_y);
  `);

  // Idle-loop video. video_status null = never attempted (only state that may
  // start a background generation); "pending"/"ready"/"failed" all short-circuit so a node is
  // never regenerated (a failed attempt just stays a static image, no auto-retry).
  ensureColumn("nodes", "video_status", "video_status TEXT");
  ensureColumn("nodes", "video_url", "video_url TEXT");

  // Page-transition morphs. Same null/pending/ready/failed contract as video
  // above, stored on the child node itself (a child has exactly one parent, so one morph per row).
  ensureColumn("nodes", "morph_status", "morph_status TEXT");
  ensureColumn("nodes", "morph_url", "morph_url TEXT");

  // Provenance: which provider drew the page, and in which art style/composition. Needed so a
  // lazily-generated aspect-ratio variant can be drawn to match the page it belongs to, rather than
  // with whatever the server is configured with at the time. Empty means "written before this
  // existed" — the variant route then falls back to the server's current settings.
  ensureColumn("nodes", "image_provider", "image_provider TEXT NOT NULL DEFAULT ''");
  ensureColumn("nodes", "art_style", "art_style TEXT NOT NULL DEFAULT ''");
  ensureColumn("nodes", "composition", "composition TEXT NOT NULL DEFAULT ''");

  // Layered page: clean background image + labels/footer rendered as a DOM overlay. `labels` is a
  // JSON-encoded array (see storage/nodes.ts rowToNode). Empty/blank/null means "written before
  // this existed" — such a node renders image-only, with no overlay.
  ensureColumn("nodes", "labels", "labels TEXT NOT NULL DEFAULT '[]'");
  ensureColumn("nodes", "footer", "footer TEXT NOT NULL DEFAULT ''");
  ensureColumn("nodes", "labels_aspect", "labels_aspect TEXT");

  // Page versions (see plans/PLAN-versions.md). An edit becomes a first-class VERSION of a page,
  // grouped with its siblings by version_group_id, rather than a hidden nested child.
  //
  // version_group_id is nullable at the SQL level, not `NOT NULL`. ALTER TABLE ADD COLUMN cannot add
  // a NOT NULL column without a constant default, and the wanted default is the row's own id, which
  // is not a constant. The backfill below fills every existing row, and rowToNode reads a missing
  // value as the row's own id, so the column is always effectively populated.
  ensureColumn("nodes", "version_group_id", "version_group_id TEXT");
  // The version this row was edited from (null for a non-edit); the edit instruction that made it.
  ensureColumn("nodes", "edited_from_id", "edited_from_id TEXT");
  ensureColumn("nodes", "edit_command", "edit_command TEXT");
  // One default per group opens by default. Every existing row becomes its own singleton default
  // group: the constant DEFAULT 1 is allowed here, and the backfill gives each row a unique group.
  ensureColumn("nodes", "is_default", "is_default INTEGER NOT NULL DEFAULT 1");

  // Backfill BEFORE the unique index is created, so the index never sees two nulls collapse or two
  // defaults collide. After this, every row is its own group (unique id) with exactly one default.
  db.exec(`UPDATE nodes SET version_group_id = id WHERE version_group_id IS NULL`);

  db.exec(`
    -- Lists and counts every version of a page.
    CREATE INDEX IF NOT EXISTS nodes_version_group_idx ON nodes(version_group_id);
    -- The safety net: at most one default per group. A bug that sets two defaults fails loudly at
    -- write time, which is the wanted behavior.
    CREATE UNIQUE INDEX IF NOT EXISTS nodes_group_default_idx ON nodes(version_group_id) WHERE is_default = 1;
    -- The landing gallery now selects the DEFAULT version of each root group. This partial index
    -- matches that query (the WHERE plus the (created_at DESC, id DESC) order) column for column.
    CREATE INDEX IF NOT EXISTS nodes_default_root_idx
      ON nodes(created_at DESC, id DESC) WHERE is_default = 1 AND parent_id IS NULL;
  `);
}

// Run eagerly so the table exists before any module that imports `db` from here
// prepares statements at its own top level (ESM evaluates this module fully first).
migrate();
