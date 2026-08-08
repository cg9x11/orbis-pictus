import "../env.js";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { strConfig } from "../config/index.js";

const dbPath = strConfig("DATABASE_URL", (c) => c.server?.databaseUrl, "./data/flipbook.db");
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
}

// Run eagerly so the table exists before any module that imports `db` from here
// prepares statements at its own top level (ESM evaluates this module fully first).
migrate();
