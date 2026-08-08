import type { AspectRatio, MorphStatus, Node, VideoStatus } from "@orbis/shared";
import { ImageVariantsSchema, MorphStatusSchema, VideoStatusSchema } from "@orbis/shared";
import { db } from "./db.js";
import type { NodeRow } from "./rows.js";

/** The column is a bare TEXT field, so anything unrecognised (or NULL) reads as "no clip". */
function toVideoStatus(raw: string | null): VideoStatus | null {
  const parsed = VideoStatusSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** The column is a bare TEXT field, so anything unrecognised (or NULL) reads as "no morph". */
function toMorphStatus(raw: string | null): MorphStatus | null {
  const parsed = MorphStatusSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function rowToNode(row: NodeRow): Node {
  return {
    id: row.id,
    parent_id: row.parent_id,
    session_id: row.session_id,
    query: row.query,
    page_title: row.page_title,
    image_variants: ImageVariantsSchema.parse(JSON.parse(row.image_variants)),
    image_model: row.image_model,
    // `?? ""` covers rows written before these columns existed: SQLite backfills the DEFAULT for
    // new rows, but a row read from an older database can still surface NULL here.
    image_provider: row.image_provider ?? "",
    art_style: row.art_style ?? "",
    composition: row.composition ?? "",
    prompt_author_model: row.prompt_author_model,
    authored_prompt: row.authored_prompt,
    created_at: row.created_at,
    version: row.version,
    video_status: toVideoStatus(row.video_status),
    morph_status: toMorphStatus(row.morph_status),
  };
}

const insertStmt = db.prepare(`
  INSERT INTO nodes
    (id, parent_id, session_id, query, page_title, image_variants, image_model, image_provider, art_style, composition, prompt_author_model, authored_prompt, created_at, version, normalized_subject, prompt_hash)
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

/** Internal cache-layer metadata, stored alongside the node but not part of the public Node schema. */
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
    node.image_provider,
    node.art_style,
    node.composition,
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
const getImageVariantsStmt = db.prepare(`SELECT image_variants FROM nodes WHERE id = ?`);

/**
 * Atomically merges one newly-generated variant into a node's stored image_variants and returns
 * the updated node (null if the node vanished). The variant handler awaits a slow image
 * generation between reading the node and writing back, so it must NOT persist a blob built from
 * its now-stale in-memory copy: two concurrent requests for different ratios would each write
 * `{original, theirRatio}` and the second would clobber the first's variant. Re-reading the
 * current blob here and merging is atomic because node:sqlite is synchronous — nothing can
 * interleave between this read and write.
 */
export function addImageVariant(id: string, ratio: AspectRatio, url: string): Node | null {
  const row = getImageVariantsStmt.get(id) as { image_variants: string } | undefined;
  if (!row) return null;
  const variants = ImageVariantsSchema.parse(JSON.parse(row.image_variants));
  variants[ratio] = url;
  updateImageVariantsStmt.run(JSON.stringify(variants), id);
  return getNode(id);
}

const getStmt = db.prepare(`SELECT * FROM nodes WHERE id = ?`);

export function getNode(id: string): Node | null {
  const row = getStmt.get(id) as NodeRow | undefined;
  return row ? rowToNode(row) : null;
}

/** Ancestor chain, root → current (excludes the node itself). The `seen` set guards against a
 *  parent-id cycle (e.g. a self-parent, or corrupt/legacy data): without it, `while` would spin
 *  forever and — because node:sqlite is synchronous — hang the whole event loop. The route layer
 *  refuses to store a node whose parent doesn't already exist, which makes a cycle impossible to
 *  create, but this stays cheap and keeps a bad row from taking the server down. */
export function getHistory(nodeId: string): Node[] {
  const chain: Node[] = [];
  const seen = new Set<string>([nodeId]);
  let cursor = getNode(nodeId);
  while (cursor?.parent_id && !seen.has(cursor.parent_id)) {
    const parent = getNode(cursor.parent_id);
    if (!parent) break;
    seen.add(parent.id);
    chain.push(parent);
    cursor = parent;
  }
  return chain.reverse();
}

const findChildBySubjectStmt = db.prepare(`
  SELECT * FROM nodes WHERE parent_id = ? AND normalized_subject = ? ORDER BY created_at ASC LIMIT 1
`);

/** Layer 2: an existing child of `parentId` already covering this normalized subject. */
export function findChildBySubject(parentId: string, normalizedSubject: string): Node | null {
  const row = findChildBySubjectStmt.get(parentId, normalizedSubject) as NodeRow | undefined;
  return row ? rowToNode(row) : null;
}

const findByPromptHashStmt = db.prepare(`
  SELECT * FROM nodes WHERE prompt_hash = ? ORDER BY created_at ASC LIMIT 1
`);

/** Layer 3: any earlier node whose authored_prompt (+ ratio/model/provider) matches exactly. */
export function findNodeByPromptHash(hash: string): Node | null {
  const row = findByPromptHashStmt.get(hash) as NodeRow | undefined;
  return row ? rowToNode(row) : null;
}

// --- Idle-loop video state. `video_status` is part of the public Node schema
// (the client needs it to tell "a clip is coming" from "none will ever exist"); `video_url` is
// internal and reachable only through GET /api/nodes/:id/video. VideoStatus itself is defined
// once, in @orbis/shared, and re-exported here for the existing server-side importers.
export type { VideoStatus };

export interface VideoInfo {
  status: VideoStatus | null;
  url: string | null;
}

const getVideoInfoStmt = db.prepare(`SELECT video_status, video_url FROM nodes WHERE id = ?`);

/** Null if the node itself doesn't exist; status null means video generation has never been attempted for it. */
export function getVideoInfo(id: string): VideoInfo | null {
  const row = getVideoInfoStmt.get(id) as { video_status: string | null; video_url: string | null } | undefined;
  if (!row) return null;
  return { status: toVideoStatus(row.video_status), url: row.video_url };
}

const setVideoStatusStmt = db.prepare(`UPDATE nodes SET video_status = ? WHERE id = ?`);

export function markVideoPending(id: string): void {
  setVideoStatusStmt.run(VideoStatusSchema.enum.pending, id);
}

export function markVideoFailed(id: string): void {
  setVideoStatusStmt.run(VideoStatusSchema.enum.failed, id);
}

const setVideoReadyStmt = db.prepare(`UPDATE nodes SET video_status = ?, video_url = ? WHERE id = ?`);

export function markVideoReady(id: string, url: string): void {
  setVideoReadyStmt.run(VideoStatusSchema.enum.ready, url, id);
}

// --- Page-transition morph state. `morph_status` is part of the public Node
// schema (same rationale as video_status); `morph_url` is internal and reachable only through
// GET /api/nodes/:id/morph. MorphStatus itself is defined once, in @orbis/shared, and
// re-exported here for the existing server-side importers.
export type { MorphStatus };

export interface MorphInfo {
  status: MorphStatus | null;
  url: string | null;
}

const getMorphInfoStmt = db.prepare(`SELECT morph_status, morph_url FROM nodes WHERE id = ?`);

/** Null if the node itself doesn't exist; status null means morph generation has never been attempted for it. */
export function getMorphInfo(id: string): MorphInfo | null {
  const row = getMorphInfoStmt.get(id) as { morph_status: string | null; morph_url: string | null } | undefined;
  if (!row) return null;
  return { status: toMorphStatus(row.morph_status), url: row.morph_url };
}

const setMorphStatusStmt = db.prepare(`UPDATE nodes SET morph_status = ? WHERE id = ?`);

export function markMorphPending(id: string): void {
  setMorphStatusStmt.run(MorphStatusSchema.enum.pending, id);
}

export function markMorphFailed(id: string): void {
  setMorphStatusStmt.run(MorphStatusSchema.enum.failed, id);
}

const setMorphReadyStmt = db.prepare(`UPDATE nodes SET morph_status = ?, morph_url = ? WHERE id = ?`);

export function markMorphReady(id: string, url: string): void {
  setMorphReadyStmt.run(MorphStatusSchema.enum.ready, url, id);
}

// Root nodes only (`parent_id IS NULL`) — the opening page of an exploration, the kind a visitor
// gets by typing a query. Tap children and edit variants are deliberately excluded: they are
// mid-exploration pages that make no sense as a starting point ("Roadway Deck" is a fine page but
// a strange thing for the landing gallery to offer). Every eligible root is listed, newest first —
// no page_title dedup: re-running the same search is a genuinely new page (a fresh image, possibly
// with video/morph the earlier one lacked), and collapsing it into the older same-titled root made
// a just-created page look like it had vanished from the gallery. Same-titled roots now each get
// their own card; being ordered by created_at keeps the newest on top where it's easy to find.
const listGalleryStmt = db.prepare(`
  SELECT * FROM nodes
  WHERE parent_id IS NULL
  ORDER BY created_at DESC LIMIT ?
`);

/**
 * Already-generated root pages for the landing-page example gallery, newest first — no new
 * generations. Pass `null` for no limit at all: SQLite reads any negative LIMIT as unbounded, so
 * one prepared statement covers both cases without a second query.
 */
export function listGalleryNodes(limit: number | null): Node[] {
  return (listGalleryStmt.all(limit ?? -1) as unknown as NodeRow[]).map(rowToNode);
}
