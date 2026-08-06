import type { ImageVariants, Node } from "@flipbook/shared";
import { db } from "./db.js";
import type { NodeRow } from "./schema.js";

function rowToNode(row: NodeRow): Node {
  return {
    id: row.id,
    parent_id: row.parent_id,
    session_id: row.session_id,
    query: row.query,
    page_title: row.page_title,
    image_variants: JSON.parse(row.image_variants),
    image_model: row.image_model,
    prompt_author_model: row.prompt_author_model,
    authored_prompt: row.authored_prompt,
    created_at: row.created_at,
    version: row.version,
  };
}

const insertStmt = db.prepare(`
  INSERT INTO nodes
    (id, parent_id, session_id, query, page_title, image_variants, image_model, prompt_author_model, authored_prompt, created_at, version, normalized_subject, prompt_hash)
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

/** Internal cache-layer metadata (PLAN §2.3), stored alongside the node but not part of the public Node schema. */
export interface NodeCacheMeta {
  normalizedSubject: string;
  /** Null when the node's image shouldn't be offered for prompt-hash reuse (e.g. edit mode — see generate.ts). */
  promptHash?: string | null;
}

export function insertNode(node: Node, meta: NodeCacheMeta): Node {
  insertStmt.run(
    node.id,
    node.parent_id,
    node.session_id,
    node.query,
    node.page_title,
    JSON.stringify(node.image_variants),
    node.image_model,
    node.prompt_author_model,
    node.authored_prompt,
    node.created_at,
    node.version,
    meta.normalizedSubject,
    meta.promptHash ?? null,
  );
  return node;
}

const updateImageVariantsStmt = db.prepare(`UPDATE nodes SET image_variants = ? WHERE id = ?`);

/** Merges a newly-generated variant into a node's stored image_variants and returns the updated node. */
export function updateImageVariants(id: string, variants: ImageVariants): Node | null {
  updateImageVariantsStmt.run(JSON.stringify(variants), id);
  return getNode(id);
}

const getStmt = db.prepare(`SELECT * FROM nodes WHERE id = ?`);

export function getNode(id: string): Node | null {
  const row = getStmt.get(id) as NodeRow | undefined;
  return row ? rowToNode(row) : null;
}

/** Ancestor chain, root → current (excludes the node itself). */
export function getHistory(nodeId: string): Node[] {
  const chain: Node[] = [];
  let cursor = getNode(nodeId);
  while (cursor?.parent_id) {
    const parent = getNode(cursor.parent_id);
    if (!parent) break;
    chain.push(parent);
    cursor = parent;
  }
  return chain.reverse();
}

const findChildBySubjectStmt = db.prepare(`
  SELECT * FROM nodes WHERE parent_id = ? AND normalized_subject = ? ORDER BY created_at ASC LIMIT 1
`);

/** PLAN §2.3 layer 2: an existing child of `parentId` already covering this normalized subject. */
export function findChildBySubject(parentId: string, normalizedSubject: string): Node | null {
  const row = findChildBySubjectStmt.get(parentId, normalizedSubject) as NodeRow | undefined;
  return row ? rowToNode(row) : null;
}

const findByPromptHashStmt = db.prepare(`
  SELECT * FROM nodes WHERE prompt_hash = ? ORDER BY created_at ASC LIMIT 1
`);

/** PLAN §2.3 layer 3: any earlier node whose authored_prompt (+ ratio/model/provider) matches exactly. */
export function findNodeByPromptHash(hash: string): Node | null {
  const row = findByPromptHashStmt.get(hash) as NodeRow | undefined;
  return row ? rowToNode(row) : null;
}

// --- PLAN §3 Phase 5: idle-loop video state (internal — never exposed via the public Node schema) ---
export type VideoStatus = "pending" | "ready" | "failed";

export interface VideoInfo {
  status: VideoStatus | null;
  url: string | null;
}

const getVideoInfoStmt = db.prepare(`SELECT video_status, video_url FROM nodes WHERE id = ?`);

/** Null if the node itself doesn't exist; status null means video generation has never been attempted for it. */
export function getVideoInfo(id: string): VideoInfo | null {
  const row = getVideoInfoStmt.get(id) as { video_status: string | null; video_url: string | null } | undefined;
  if (!row) return null;
  return { status: row.video_status as VideoStatus | null, url: row.video_url };
}

const setVideoStatusStmt = db.prepare(`UPDATE nodes SET video_status = ? WHERE id = ?`);

export function markVideoPending(id: string): void {
  setVideoStatusStmt.run("pending", id);
}

export function markVideoFailed(id: string): void {
  setVideoStatusStmt.run("failed", id);
}

const setVideoReadyStmt = db.prepare(`UPDATE nodes SET video_status = 'ready', video_url = ? WHERE id = ?`);

export function markVideoReady(id: string, url: string): void {
  setVideoReadyStmt.run(url, id);
}

const listGalleryStmt = db.prepare(`SELECT * FROM nodes ORDER BY RANDOM() LIMIT ?`);

/** Random sample of already-generated nodes for the landing-page example gallery — no new generations. */
export function listGalleryNodes(limit: number): Node[] {
  return (listGalleryStmt.all(limit) as unknown as NodeRow[]).map(rowToNode);
}
