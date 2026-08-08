import type { AspectRatio, MorphStatus, Node, VideoStatus } from "@orbis/shared";
import { ImageVariantsSchema, MorphStatusSchema, VideoStatusSchema } from "@orbis/shared";
import { db } from "./db.js";
import type { NodeRow } from "./rows.js";

/** The column is a bare TEXT field, so anything unrecognized (or NULL) reads as "no clip". */
function toVideoStatus(raw: string | null): VideoStatus | null {
  const parsed = VideoStatusSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** The column is a bare TEXT field, so anything unrecognized (or NULL) reads as "no morph". */
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
    // `?? ""` covers rows that the code wrote before these columns existed. SQLite backfills the
    // DEFAULT for new rows. A row from an older database can still return NULL here.
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
  /** Null when the image of the node must not be offered for prompt-hash reuse. Edit mode is one
   *  such case (see generate.ts). */
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
 * Merges one new variant into the stored image_variants of a node and returns the updated node.
 * Returns null when the node no longer exists. The merge is atomic.
 *
 * The variant handler awaits a slow image generation between the read of the node and the write
 * back. For that reason it must NOT persist a blob built from its stale in-memory copy. Two
 * concurrent requests for different ratios each write `{original, theirRatio}`, and the second
 * one overwrites the variant of the first. This function instead re-reads the current blob and
 * merges into it. That is atomic because node:sqlite is synchronous, so nothing can run between
 * this read and this write.
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

/** The ancestor chain, from root to current. It excludes the node itself.
 *
 *  The `seen` set guards against a parent-id cycle. A self-parent row or corrupt legacy data can
 *  create one. Without the guard, the `while` loop spins forever. It then hangs the whole event
 *  loop, because node:sqlite is synchronous. The route layer refuses to store a node when the
 *  parent does not already exist, so a cycle is impossible to create. This guard stays cheap, and
 *  it stops a bad row from bringing the server down. */
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

/** Layer 2: an existing child of `parentId` that already covers this normalized subject. */
export function findChildBySubject(parentId: string, normalizedSubject: string): Node | null {
  const row = findChildBySubjectStmt.get(parentId, normalizedSubject) as NodeRow | undefined;
  return row ? rowToNode(row) : null;
}

const findChildrenBySubjectStmt = db.prepare(`
  SELECT * FROM nodes WHERE parent_id = ? AND normalized_subject = ? ORDER BY created_at ASC
`);

/**
 * Every child of `parentId` that covers this normalized subject, oldest first. Under `reuse` the
 * result is always zero or one row, because layer 2 stops the creation of a second one. Under
 * `variant`, each repeat tap adds another row, and the tap panel must show all of them.
 */
export function findChildrenBySubject(parentId: string, normalizedSubject: string): Node[] {
  const rows = findChildrenBySubjectStmt.all(parentId, normalizedSubject) as unknown as NodeRow[];
  return rows.map(rowToNode);
}

const findByPromptHashStmt = db.prepare(`
  SELECT * FROM nodes WHERE prompt_hash = ? ORDER BY created_at ASC LIMIT 1
`);

/** Layer 3: any earlier node whose authored_prompt (plus ratio, model, and provider) matches exactly. */
export function findNodeByPromptHash(hash: string): Node | null {
  const row = findByPromptHashStmt.get(hash) as NodeRow | undefined;
  return row ? rowToNode(row) : null;
}

// --- Idle-loop video state. `video_status` is part of the public Node schema. The client needs
// it to tell "a clip is coming" apart from "none will ever exist". `video_url` is internal, and
// only GET /api/nodes/:id/video reaches it. @orbis/shared defines VideoStatus one time, and this
// module re-exports it for the existing server-side importers.
export type { VideoStatus };

export interface VideoInfo {
  status: VideoStatus | null;
  url: string | null;
}

const getVideoInfoStmt = db.prepare(`SELECT video_status, video_url FROM nodes WHERE id = ?`);

/** Returns null when the node itself does not exist. A null status means that no video generation
 *  ever started for the node. */
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

// --- Page-transition morph state. `morph_status` is part of the public Node schema, for the same
// reason as video_status. `morph_url` is internal, and only GET /api/nodes/:id/morph reaches it.
// @orbis/shared defines MorphStatus one time, and this module re-exports it for the existing
// server-side importers.
export type { MorphStatus };

export interface MorphInfo {
  status: MorphStatus | null;
  url: string | null;
}

const getMorphInfoStmt = db.prepare(`SELECT morph_status, morph_url FROM nodes WHERE id = ?`);

/** Returns null when the node itself does not exist. A null status means that no morph generation
 *  ever started for the node. */
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

// Root nodes only (`parent_id IS NULL`). A root is the opening page of an exploration, the kind
// that a visitor gets from a typed query. This query excludes tap children and edit variants on
// purpose. Those are mid-exploration pages, and they make no sense as a starting point. "Roadway
// Deck" is a fine page, but it is a strange thing for the landing gallery to offer.
//
// The query lists every eligible root, newest first. It does not deduplicate by page_title. A
// repeat of the same search produces a genuinely new page with a fresh image. That new page
// sometimes has video or morph that the earlier page lacked. An earlier version collapsed it into
// the older root with the same title. A just-created page then looked like it was gone from the
// gallery.
//
// Each root with the same title now gets its own card. The order by created_at keeps the newest
// card on top, where it is easy to find.
const listGalleryStmt = db.prepare(`
  SELECT * FROM nodes
  WHERE parent_id IS NULL
  ORDER BY created_at DESC LIMIT ?
`);

/**
 * Returns already-generated root pages for the example gallery on the landing page, newest first.
 * This function never starts a new generation.
 *
 * To apply no limit, pass `null`. SQLite reads any negative LIMIT as unbounded, so one prepared
 * statement covers both cases without a second query.
 */
export function listGalleryNodes(limit: number | null): Node[] {
  return (listGalleryStmt.all(limit ?? -1) as unknown as NodeRow[]).map(rowToNode);
}
