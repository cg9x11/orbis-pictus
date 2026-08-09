import type { AspectRatio, MorphStatus, Node, VideoStatus } from "@orbis/shared";
import { AspectRatioSchema, groupIdOf, ImageVariantsSchema, MorphStatusSchema, sanitizePageLabels, VideoStatusSchema } from "@orbis/shared";
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

/** The column is a bare TEXT field, so anything unrecognized (or NULL) reads as "no overlay" —
 *  same contract as toVideoStatus/toMorphStatus above. */
function toLabelsAspect(raw: string | null): AspectRatio | null {
  const parsed = AspectRatioSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** The `labels` column is a JSON-encoded array. A row written before this existed, or corrupt
 *  JSON, reads as "no labels" rather than throwing and failing the whole node read. `sanitizePageLabels`
 *  clamps coordinates and drops any single malformed entry (the same rule the write path uses), so one
 *  bad stored label can never blank out the rest of the overlay. */
function toLabels(raw: string): Node["labels"] {
  try {
    return sanitizePageLabels(JSON.parse(raw));
  } catch {
    return [];
  }
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
    labels: toLabels(row.labels),
    footer: row.footer ?? "",
    labels_aspect: toLabelsAspect(row.labels_aspect),
    created_at: row.created_at,
    version: row.version,
    video_status: toVideoStatus(row.video_status),
    morph_status: toMorphStatus(row.morph_status),
    // Page versions. `?? row.id` covers a row written before this column existed (the backfill fills
    // it, but a read of a not-yet-migrated database still returns null). is_default is 0/1 in SQLite.
    version_group_id: row.version_group_id ?? row.id,
    edited_from_id: row.edited_from_id ?? null,
    edit_command: row.edit_command ?? null,
    is_default: row.is_default === 1,
  };
}

const insertStmt = db.prepare(`
  INSERT INTO nodes
    (id, parent_id, session_id, query, page_title, image_variants, image_model, image_provider, art_style, composition, prompt_author_model, authored_prompt, labels, footer, labels_aspect, created_at, version, normalized_subject, prompt_hash, version_group_id, edited_from_id, edit_command, is_default)
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

/** Internal cache-layer metadata, stored alongside the node but not part of the public Node schema. */
export interface NodeCacheMeta {
  normalizedSubject: string;
  /** Null when the image of the node must not be offered for prompt-hash reuse. Edit mode is one
   *  such case (see generate.ts). */
  promptHash?: string | null;
}

/** Binds and runs one INSERT, defaulting the version fields: a brand-new page is its own group and
 *  its own default. Only an edit overrides these — see insertVersionAsDefault. */
function runInsert(node: Node, meta: NodeCacheMeta): void {
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
    JSON.stringify(node.labels),
    node.footer,
    node.labels_aspect,
    node.created_at,
    node.version,
    meta.normalizedSubject,
    meta.promptHash ?? null,
    groupIdOf(node),
    node.edited_from_id ?? null,
    node.edit_command ?? null,
    (node.is_default ?? true) ? 1 : 0,
  );
}

export function insertNode(node: Node, meta: NodeCacheMeta): Node {
  runInsert(node, meta);
  return node;
}

const clearGroupDefaultStmt = db.prepare(`UPDATE nodes SET is_default = 0 WHERE version_group_id = ? AND is_default = 1`);
const setDefaultStmt = db.prepare(`UPDATE nodes SET is_default = 1 WHERE id = ?`);

/**
 * node:sqlite has no transaction helper, so BEGIN/COMMIT/ROLLBACK is explicit. This wraps `fn` in one
 * transaction: a throw rolls the whole thing back and re-throws, so a multi-write is all-or-nothing.
 * A caller that retries must retry the whole call, so a retry re-runs every step atomically.
 */
function inTransaction<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * Inserts a node that joins an EXISTING version group and becomes its default. The old default is
 * cleared FIRST, in the same transaction, or the one-default-per-group unique index rejects the
 * insert. A failure rolls the whole thing back, so the group is never left with zero defaults.
 */
export function insertVersionAsDefault(node: Node, meta: NodeCacheMeta): Node {
  const groupId = groupIdOf(node);
  inTransaction(() => {
    clearGroupDefaultStmt.run(groupId);
    runInsert({ ...node, version_group_id: groupId, is_default: true }, meta);
  });
  return node;
}

/**
 * Makes `nodeId` the default of its group (the star action). Clears the group's old default first,
 * in one transaction. Returns the updated node, or null when it does not exist.
 */
export function setDefaultVersion(nodeId: string): Node | null {
  const node = getNode(nodeId);
  if (!node) return null;
  const groupId = groupIdOf(node);
  inTransaction(() => {
    clearGroupDefaultStmt.run(groupId);
    setDefaultStmt.run(nodeId);
  });
  return getNode(nodeId);
}

const listVersionsStmt = db.prepare(`SELECT * FROM nodes WHERE version_group_id = ? ORDER BY created_at ASC, id ASC`);

/** Every version of a page, oldest first. `groupId` is the version_group_id of any member. */
export function listVersions(groupId: string): Node[] {
  const rows = listVersionsStmt.all(groupId) as unknown as NodeRow[];
  return rows.map(rowToNode);
}

const countGroupVersionsStmt = db.prepare(`SELECT COUNT(*) AS c FROM nodes WHERE version_group_id = ?`);

/** How many versions a page has. One means a singleton (no edits), so the branch control hides. */
export function countGroupVersions(groupId: string): number {
  const row = countGroupVersionsStmt.get(groupId) as { c: number };
  return row.c;
}

const getGroupDefaultStmt = db.prepare(`SELECT * FROM nodes WHERE version_group_id = ? AND is_default = 1 LIMIT 1`);

/**
 * The version a group opens by default. Tap reuse and the tap markers find the PRIMARY child of a
 * subject (findChildBySubject excludes edit versions), but the page a user expects for that subject
 * is now the group's current default. Resolving the primary through this keeps a repeat tap consistent
 * with the branch control and the gallery card. Returns null only for an unknown group.
 */
export function getGroupDefault(groupId: string): Node | null {
  const row = getGroupDefaultStmt.get(groupId) as NodeRow | undefined;
  return row ? rowToNode(row) : null;
}

/**
 * Resolves a PRIMARY child (as findChildBySubject returns) to its group's current default, falling
 * back to the child itself for a group with no edits. Tap reuse and the tap markers both open the
 * page the user expects for a subject, which is the group default — not the old primary — so this
 * keeps a repeat tap consistent with the branch control and the gallery card.
 */
export function resolveGroupDefault(node: Node): Node {
  return getGroupDefault(groupIdOf(node)) ?? node;
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

// `edited_from_id IS NULL` excludes edit versions. An edit inherits its source's parent_id and
// normalized_subject (the edit topic is the parent's own topic), so without this filter a version
// would look like a tap sibling: the tap panel would list it, and reuse-mode dedup would resolve a
// repeat tap to it. Only the primary (non-edit) children count as tap children. See PLAN, finding 4.
const findChildBySubjectStmt = db.prepare(`
  SELECT * FROM nodes WHERE parent_id = ? AND normalized_subject = ? AND edited_from_id IS NULL ORDER BY created_at ASC LIMIT 1
`);

/** Layer 2: an existing child of `parentId` that already covers this normalized subject. */
export function findChildBySubject(parentId: string, normalizedSubject: string): Node | null {
  const row = findChildBySubjectStmt.get(parentId, normalizedSubject) as NodeRow | undefined;
  return row ? rowToNode(row) : null;
}

// `edited_from_id IS NULL` for the same reason as findChildBySubjectStmt above: the tap panel must
// list only real tap children, never edit versions that happen to share the parent and subject.
const findChildrenBySubjectStmt = db.prepare(`
  SELECT * FROM nodes WHERE parent_id = ? AND normalized_subject = ? AND edited_from_id IS NULL ORDER BY created_at ASC
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

// The DEFAULT version of each root group (`is_default = 1 AND parent_id IS NULL`). A root is the
// opening page of an exploration, the kind that a visitor gets from a typed query. Every version of
// a root group shares `parent_id IS NULL`, so the `is_default = 1` filter collapses the group to its
// one default version — one card per page, not one per edit. This query still excludes tap children
// (they have a non-null parent) and non-default edit versions on purpose. Those are mid-exploration
// pages, and they make no sense as a starting point. "Roadway Deck" is a fine page, but it is a
// strange thing for the landing gallery to offer.
//
// The query lists every eligible root, newest first. It does not deduplicate by page_title. A
// repeat of the same search produces a genuinely new page with a fresh image. That new page
// sometimes has video or morph that the earlier page lacked. An earlier version collapsed it into
// the older root with the same title. A just-created page then looked like it was gone from the
// gallery.
//
// Each root with the same title now gets its own card. The order by created_at keeps the newest
// card on top, where it is easy to find.
//
// The sort key is the pair (created_at, id), not created_at alone. created_at is an ISO string at
// millisecond resolution, so two roots created in the same millisecond tie. A tie makes the order
// of those two rows undefined, and keyset pagination on an undefined order drops rows or repeats
// them. The primary key breaks every tie, so the order is total and each row has one position.
const listGalleryFirstStmt = db.prepare(`
  SELECT * FROM nodes
  WHERE is_default = 1 AND parent_id IS NULL
  ORDER BY created_at DESC, id DESC
  LIMIT ?
`);

// The same query, seeked to the row after the cursor. The row-value comparison
// `(created_at, id) < (?, ?)` is the two-column form of "strictly older than the cursor row", and
// it reads straight down the partial nodes_default_root_idx (the index that matches the
// `is_default = 1 AND parent_id IS NULL` filter plus this order).
const listGalleryAfterStmt = db.prepare(`
  SELECT * FROM nodes
  WHERE is_default = 1 AND parent_id IS NULL
    AND (created_at, id) < (?, ?)
  ORDER BY created_at DESC, id DESC
  LIMIT ?
`);

/** Cursor field separator. Safe because an ISO timestamp never contains it. */
const CURSOR_SEPARATOR = "|";

/** Builds the cursor that points AT `node`, meaning the next page starts below it. */
function encodeGalleryCursor(node: Node): string {
  return `${node.created_at}${CURSOR_SEPARATOR}${node.id}`;
}

/**
 * The exact shape that `Date.prototype.toISOString` produces, which is what every writer of
 * `created_at` uses. The timestamp half of a cursor is compared against that column as a string,
 * so it has to be in the column's own format to mean anything.
 */
const ISO_UTC_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Parses a `created_at|id` cursor, or returns null if it is malformed.
 *
 * The caller must treat null as a client error rather than silently serving the first page. A bad
 * cursor that quietly returns page one makes "Load more" append a batch the reader already has.
 *
 * The timestamp half is validated, not merely separated out. The seek compares it as a string, so
 * any text at all produces a valid-looking comparison and a wrong answer. `zzz|x` is the worst
 * case: every real timestamp begins with a digit, digits sort below `z`, so every root matches and
 * the whole gallery comes back as "the page after your cursor".
 */
export function decodeGalleryCursor(raw: string): { createdAt: string; id: string } | null {
  // Split at the FIRST separator only. The timestamp cannot contain one, but no assumption is made
  // about the id's alphabet, so everything after the first separator is the id.
  const at = raw.indexOf(CURSOR_SEPARATOR);
  if (at <= 0 || at === raw.length - 1) return null;

  const createdAt = raw.slice(0, at);
  // Both checks are needed. The pattern rejects free text such as "zzz". Date.parse rejects a
  // string that fits the pattern but names no real instant, such as "2026-13-45T99:99:99.999Z".
  if (!ISO_UTC_MILLIS.test(createdAt) || !Number.isFinite(Date.parse(createdAt))) return null;

  return { createdAt, id: raw.slice(at + 1) };
}

/** One batch of gallery cards, plus the cursor that reaches the batch after it. */
export type GalleryPage = {
  nodes: Node[];
  /** Pass back as `?cursor=`. Null means this batch was the last one. */
  nextCursor: string | null;
};

/**
 * Returns one page of already-generated root pages for the landing gallery, newest first. This
 * function never starts a new generation.
 *
 * Pass `limit: null` for every eligible root with no cap. SQLite reads a negative LIMIT as
 * unbounded, so the same prepared statement covers both cases. An unbounded read has nothing left
 * to fetch afterwards, so its `nextCursor` is always null.
 *
 * Pass `cursor` to continue below a previous batch. A cursor the caller cannot parse must never
 * reach this function — decode it first and reject it.
 */
export function listGalleryPage({
  limit,
  cursor = null,
}: {
  limit: number | null;
  cursor?: { createdAt: string; id: string } | null;
}): GalleryPage {
  // Ask for one row more than the caller wants. If that extra row comes back, a further page
  // exists. This costs one row instead of the separate COUNT(*) that a total would need, and it
  // cannot disagree with the page itself the way a separately-counted total can.
  const probe = limit === null ? -1 : limit + 1;
  const rows = (
    cursor
      ? listGalleryAfterStmt.all(cursor.createdAt, cursor.id, probe)
      : listGalleryFirstStmt.all(probe)
  ) as unknown as NodeRow[];

  const hasMore = limit !== null && rows.length > limit;
  const nodes = (hasMore ? rows.slice(0, limit) : rows).map(rowToNode);
  const last = nodes[nodes.length - 1];
  return {
    nodes,
    nextCursor: hasMore && last ? encodeGalleryCursor(last) : null,
  };
}
