import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

const dbPath = process.env.DATABASE_URL ?? "./data/flipbook.db";
fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL;");

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
}

// Run eagerly so the table exists before any module that imports `db` from here
// prepares statements at its own top level (ESM evaluates this module fully first).
migrate();
