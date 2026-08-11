import path from "node:path";
import dotenv from "dotenv";
import { REPO_ROOT } from "./paths.js";

// .env lives at the repo root next to config.yml - resolved from REPO_ROOT rather than cwd, because
// the server runs with cwd = apps/server. See paths.ts for the layout this depends on.
dotenv.config({ path: path.join(REPO_ROOT, ".env") });
