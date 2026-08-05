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
    (id, parent_id, session_id, query, page_title, image_variants, image_model, prompt_author_model, authored_prompt, created_at, version)
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

export function insertNode(node: Node): Node {
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
