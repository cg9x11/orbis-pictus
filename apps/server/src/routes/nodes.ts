import crypto from "node:crypto";
import { Hono } from "hono";
import { NodesCreateRequestSchema, type Node } from "@flipbook/shared";
import { getHistory, getNode, insertNode } from "../storage/nodes.js";

export function nodesRoute(): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = NodesCreateRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid request", issues: parsed.error.issues }, 400);
    }
    const input = parsed.data;

    const id = input.id ?? crypto.randomUUID().replace(/-/g, "");
    const existing = getNode(id);
    if (existing) return c.json({ node: existing }, 200);

    const node: Node = {
      ...input,
      id,
      created_at: new Date().toISOString(),
      version: 1,
    };
    insertNode(node);
    return c.json({ node }, 201);
  });

  app.get("/:id", (c) => {
    const id = c.req.param("id");
    const node = getNode(id);
    if (!node) return c.json({ error: "Not found" }, 404);
    const history = getHistory(id);
    return c.json({ node, history });
  });

  return app;
}
