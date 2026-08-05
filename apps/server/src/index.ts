import "./env.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { migrate } from "./storage/db.js";
import { createProviders, getMissingKeys } from "./providers/index.js";
import { generateRoute } from "./routes/generate.js";
import { nodesRoute } from "./routes/nodes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

migrate();

const providers = createProviders();
const missingKeys = getMissingKeys();
if (missingKeys.length > 0) {
  console.warn(
    `[flipbook] Missing API keys: ${missingKeys.join(", ")}. Falling back to mock providers for the affected capability.\n` +
      `[flipbook] Add these to .env to use real providers (see .env.example).`,
  );
}

const imagesDir = path.resolve(process.cwd(), process.env.IMAGES_DIR ?? "./data/images");

const app = new Hono();
app.use("/api/*", cors());

app.route("/api/generate", generateRoute(providers, imagesDir));
app.route("/api/nodes", nodesRoute(providers, imagesDir));
app.get("/api/waitroom", (c) => c.json({ enabled: false, admitted: true }));

app.use("/images/*", serveStatic({ root: path.relative(process.cwd(), path.dirname(imagesDir)) }));

// In production, serve the built SPA for everything else.
const webDist = path.resolve(__dirname, "../../web/dist");
app.use("/*", serveStatic({ root: path.relative(process.cwd(), webDist) }));
app.get("*", serveStatic({ path: path.join(path.relative(process.cwd(), webDist), "index.html") }));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[flipbook] server listening on http://localhost:${info.port}`);
});
