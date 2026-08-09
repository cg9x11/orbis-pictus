import "./env.js";
import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import "./storage/db.js"; // eagerly opens the DB connection and runs migrations as an import side effect
import { resolveProviders, type ProviderResolver } from "./providers/index.js";
import { buildModelSettings } from "./providers/catalog.js";
import { generateRoute } from "./routes/generate.js";
import { nodesRoute } from "./routes/nodes.js";
import { getNode } from "./storage/nodes.js";
import { videoPipeline } from "./pipeline/video.js";
import { morphPipeline } from "./pipeline/morph.js";
import { isVideoEnabled } from "./pipeline/videoConfig.js";
import { isMorphEnabled } from "./pipeline/morphConfig.js";
import { getDefaultArtStyleName, listArtStyles, getDefaultCompositionName, listCompositions } from "./pipeline/artStyle.js";
import { isUploadEnabled } from "./pipeline/config.js";
import { intConfig, strConfig, watchConfigFile, resolveConfigPath } from "./config/index.js";
import { WEB_DIST, WEB_SRC_INDEX_HTML } from "./paths.js";

// Resolved once here purely to report missing keys at startup and to answer /api/config's
// `searchAvailable` — search is not UI-selectable, so this instance is the real one. Every request
// resolves its own set (see `resolve` below), which is what lets a model change apply without a
// restart; nothing downstream holds this object.
const { providers: bootProviders, missingKeys } = resolveProviders();
if (missingKeys.length > 0) {
  console.warn(
    `[orbis] Missing API keys: ${missingKeys.join(", ")}. Falling back to mock providers for the affected capability.\n` +
      `[orbis] Add these to .env to use real providers (see .env.example).`,
  );
}

const imagesDir = path.resolve(process.cwd(), strConfig("IMAGES_DIR", (c) => c.server?.imagesDir, "./data/images"));

const app = new Hono();
app.use("/api/*", cors());

// Routes get the resolver, not a built set: each request resolves its own providers from its own
// overrides, so switching image/video model in the UI needs no restart.
const resolve: ProviderResolver = (overrides) => resolveProviders(overrides).providers;

app.route("/api/generate", generateRoute(resolve, imagesDir, videoPipeline, morphPipeline));
app.route("/api/nodes", nodesRoute(resolve, imagesDir, videoPipeline, morphPipeline));
app.get("/api/waitroom", (c) => c.json({ enabled: false, admitted: true }));
app.get("/api/config", (c) =>
  c.json({
    searchAvailable: bootProviders.search.available,
    videoEnabled: isVideoEnabled(),
    morphEnabled: isMorphEnabled(),
    uploadEnabled: isUploadEnabled(),
    artStyles: listArtStyles(),
    artStyle: getDefaultArtStyleName(),
    compositions: listCompositions(),
    composition: getDefaultCompositionName(),
    // Built per request, not at boot, so a config.yml edit reaches the settings panel on the next
    // page load with no restart.
    modelSettings: buildModelSettings(),
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

const webDistIndexHtml = path.join(WEB_DIST, "index.html");
// In dev, dist/ doesn't exist yet — fall back to the raw source index.html (WEB_SRC_INDEX_HTML).
// This route is not reached by a real browser in dev (Vite serves /n/:id itself via its SPA
// fallback; it is deliberately NOT proxied here — see vite.config.ts), so the fallback exists only
// for a direct hit on this server, e.g. a link-unfurling bot reading the OG tags below.
//
// Resolved and read ONCE at module load: the template is static in production, and dev never reaches
// this route through it, so an existsSync + full-file read on every deep-link/unfurl hit was pure
// waste on the synchronous event loop. Each request now only splices its OG tags into this string.
const BASE_INDEX_HTML = fs.readFileSync(fs.existsSync(webDistIndexHtml) ? webDistIndexHtml : WEB_SRC_INDEX_HTML, "utf-8");

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

// Server-rendered so link-unfurling bots (which don't run JS) see the right title + image.
app.get("/n/:id", (c) => {
  const id = c.req.param("id");
  let html = BASE_INDEX_HTML;

  const node = getNode(id);
  if (node) {
    const origin = new URL(c.req.url).origin;
    const imagePath = node.image_variants["16:9"] ?? Object.values(node.image_variants)[0];
    const title = escapeHtml(`${node.page_title} — Orbis Pictus`);
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
app.use("/*", serveStatic({ root: path.relative(process.cwd(), WEB_DIST) }));
app.get("*", serveStatic({ path: path.join(path.relative(process.cwd(), WEB_DIST), "index.html") }));

const port = intConfig("PORT", (c) => c.server?.port, 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[orbis] server listening on http://localhost:${info.port}`);
  // Armed here and nowhere else: only the long-running server benefits from a live report, and a
  // watcher in the test or script processes would just hold the event loop open.
  watchConfigFile();
  console.log(`[orbis] watching for config changes: ${resolveConfigPath()}`);
});
