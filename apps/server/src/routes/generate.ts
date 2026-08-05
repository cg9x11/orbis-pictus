import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { GenerateRequestSchema } from "@flipbook/shared";
import type { Providers } from "../providers/index.js";
import { runGenerate } from "../pipeline/generate.js";

export function generateRoute(providers: Providers, imagesDir: string): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = GenerateRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid request", issues: parsed.error.issues }, 400);
    }
    const req = parsed.data;

    return streamSSE(c, async (stream) => {
      try {
        await runGenerate(req, { providers, imagesDir }, async (event) => {
          await stream.writeSSE({ event: event.event, data: JSON.stringify(event.data) });
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        await stream.writeSSE({ event: "error", data: JSON.stringify({ message }) });
      }
    });
  });

  return app;
}
