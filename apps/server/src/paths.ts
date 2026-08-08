import path from "node:path";
import { fileURLToPath } from "node:url";

// The one place that encodes repo layout: anything needing a file outside its own directory resolves
// it through these constants rather than counting "../" itself. Imported by env.ts, so it must stay
// side-effect-free and import nothing beyond node builtins.
//
// THIS FILE'S OWN LOCATION IS LOAD-BEARING: every export below is derived from `apps/server/src/`,
// so moving paths.ts to a subdirectory silently shifts all of them. Because the prompt modules
// read from PROMPTS_DIR at import time, the first symptom would be an ENOENT crash at server boot.
// paths.test.ts pins each export to an independent on-disk marker to catch that instead.

/** `apps/server` — the server package root. */
export const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The monorepo root, where `config.yml` and `.env` live. */
export const REPO_ROOT = path.resolve(SERVER_ROOT, "../..");

/** The `.md` system prompts. Anchored to `src/` because they are source, never compiled or copied. */
export const PROMPTS_DIR = path.join(SERVER_ROOT, "src", "prompts");

/** The web app's built SPA, served in production. */
export const WEB_DIST = path.join(REPO_ROOT, "apps", "web", "dist");

/** The web app's source `index.html` — dev fallback before a build exists (see index.ts). */
export const WEB_SRC_INDEX_HTML = path.join(REPO_ROOT, "apps", "web", "index.html");
