import "./env.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import "./storage/db.js"; // eagerly opens the DB connection and runs migrations as an import side effect
import { createProviders } from "./providers/index.js";
import { generateRoute } from "./routes/generate.js";
import { nodesRoute } from "./routes/nodes.js";
import { getNode } from "./storage/nodes.js";
import { videoPipeline } from "./pipeline/video.js";
import { morphPipeline } from "./pipeline/morph.js";
import { isVideoEnabled } from "./pipeline/videoConfig.js";
import { isMorphEnabled } from "./pipeline/morphConfig.js";
import { getDefaultArtStyleName, listArtStyles, getDefaultCompositionName, listCompositions } from "./pipeline/artStyle.js";
import { isUploadEnabled } from "./pipeline/config.js";
import { intConfig, strConfig } from "./config/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { providers, missingKeys } = createProviders();
if (missingKeys.length > 0) {
  console.warn(
    `[flipbook] Missing API keys: ${missingKeys.join(", ")}. Falling back to mock providers for the affected capability.\n` +
      `[flipbook] Add these to .env to use real providers (see .env.example).`,
  );
}

const imagesDir = path.resolve(process.cwd(), strConfig("IMAGES_DIR", (c) => c.server?.imagesDir, "./data/images"));

const app = new Hono();
app.use("/api/*", cors());

app.route("/api/generate", generateRoute(providers, imagesDir, videoPipeline, morphPipeline));
app.route("/api/nodes", nodesRoute(providers, imagesDir, videoPipeline, morphPipeline));
app.get("/api/waitroom", (c) => c.json({ enabled: false, admitted: true }));
app.get("/api/config", (c) =>
  c.json({
    searchAvailable: providers.search.available,
    videoEnabled: isVideoEnabled(),
    morphEnabled: isMorphEnabled(),
    uploadEnabled: isUploadEnabled(),
    artStyles: listArtStyles(),
    artStyle: getDefaultArtStyleName(),
    compositions: listCompositions(),
    composition: getDefaultCompositionName(),
  }),
);

// Root must be imagesDir itself, with the "/images" URL prefix stripped explicitly — not
// path.dirname(imagesDir), which only ever worked by coincidence when IMAGES_DIR is named
// "images". Any other folder name silently 404s here and falls through to the SPA catch-all
// below, which returns a 200 with index.html instead of a real 404 for a missing image.
app.use(
  "/images/*",
  serveStatic({
    root: path.relative(process.cwd(), imagesDir),
    rewriteRequestPath: (p) => p.replace(/^\/images/, ""),
  }),
);

const webDist = path.resolve(__dirname, "../../web/dist");
const webDistIndexHtml = path.join(webDist, "index.html");
// In dev, dist/ doesn't exist yet — fall back to the raw source index.html. This route is not
// reached by a real browser in dev (Vite serves /n/:id itself via its SPA fallback; it is
// deliberately NOT proxied here — see vite.config.ts), so the fallback exists only for a direct hit
// on this server, e.g. a link-unfurling bot reading the OG tags below.
const webSrcIndexHtml = path.resolve(__dirname, "../../web/index.html");

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// Server-rendered so link-unfurling bots (which don't run JS) see the right title + image.
app.get("/n/:id", (c) => {
  const id = c.req.param("id");
  const indexPath = fs.existsSync(webDistIndexHtml) ? webDistIndexHtml : webSrcIndexHtml;
  let html = fs.readFileSync(indexPath, "utf-8");

  const node = getNode(id);
  if (node) {
    const origin = new URL(c.req.url).origin;
    const imagePath = node.image_variants["16:9"] ?? Object.values(node.image_variants)[0];
    const title = escapeHtml(`${node.page_title} — flipbook`);
    const ogTags = [
      `<meta property="og:title" content="${title}" />`,
      imagePath ? `<meta property="og:image" content="${origin}${imagePath}" />` : "",
      `<meta property="og:type" content="website" />`,
      `<meta name="twitter:card" content="summary_large_image" />`,
    ]
      .filter(Boolean)
      .join("\n    ");
    // Function replacers, not string replacers: a string replacement interprets `$&`, `` $` ``,
    // `$'`, `$$` as replacement patterns, and page_title is client-controlled — a title containing
    // `$&` would splice matched page HTML into the <title>/head and corrupt the document.
    // escapeHtml doesn't cover `$` (it isn't an HTML metachar), so neutralize it here instead.
    html = html.includes("<title>")
      ? html.replace(/<title>.*?<\/title>/, () => `<title>${title}</title>`)
      : html.replace("</head>", () => `<title>${title}</title>\n  </head>`);
    html = html.replace("</head>", () => `${ogTags}\n  </head>`);
  }

  return c.html(html);
});

// In production, serve the built SPA for everything else.
app.use("/*", serveStatic({ root: path.relative(process.cwd(), webDist) }));
app.get("*", serveStatic({ path: path.join(path.relative(process.cwd(), webDist), "index.html") }));

const port = intConfig("PORT", (c) => c.server?.port, 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[flipbook] server listening on http://localhost:${info.port}`);
});
