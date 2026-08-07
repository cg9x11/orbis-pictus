import "../env.js"; // load .env before any config value (incl. CONFIG_FILE) is read, regardless of import order
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { FileConfigSchema, type FileConfig } from "./schema.js";

// config.yml lives at the repo root next to .env. Resolve it relative to THIS module (the same way
// env.ts resolves .env), NOT process.cwd(): the server runs with cwd = apps/server (it's launched
// via the `npm run dev --workspace=apps/server` workspace script), so a cwd-relative lookup silently
// misses the repo-root file and every config.yml value falls back to its default — this module is
// apps/server/src/config/, so four levels up is the repo root.
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CONFIG_PATH = path.resolve(moduleDir, "../../../../config.yml");

/** The config file that will actually be read: CONFIG_FILE (resolved against cwd) if set, else the
 *  repo-root config.yml. Exported so its resolution can be asserted in tests. */
export function resolveConfigPath(): string {
  const override = process.env.CONFIG_FILE?.trim();
  return override ? path.resolve(override) : DEFAULT_CONFIG_PATH;
}

/**
 * Hybrid configuration source. Non-secret settings live in an optional `config.yml` (structured,
 * easy to manage many providers — see config.example.yml); secrets (API keys) stay in the
 * environment only. Every setting resolves with a fixed precedence:
 *
 *     environment variable  >  config.yml value  >  built-in default
 *
 * Environment-first is deliberate: it matches 12-factor deployment (a host injects overrides via env
 * without editing files) AND keeps the existing test suite working unchanged — tests set
 * `process.env.*` before importing, so env continues to win and no `config.yml` is present in CI.
 *
 * Values are resolved per call (env is read live), so nothing here caches an env value; only the
 * parsed file is cached, since it cannot change during a run.
 */

// undefined = not yet loaded; null = loaded, no file present.
let cachedFile: FileConfig | null | undefined;
let cachedMtimeMs = 0; // mtime of the file backing cachedFile (0 when no file present)
let lastStatMs = 0; // wall-clock of the last freshness check, to throttle the stat
const STAT_THROTTLE_MS = 1000;

/** Read + validate the file at `filePath` (null if it doesn't exist). Throws on invalid content. */
function loadFile(filePath: string): FileConfig | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = (parseYaml(fs.readFileSync(filePath, "utf-8")) ?? {}) as unknown;
  const parsed = FileConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`[flipbook] Invalid config file at ${filePath}:\n${details}`);
  }
  return parsed.data;
}

function fileConfig(): FileConfig {
  const filePath = resolveConfigPath();
  const now = Date.now();
  // Hot-reload: if config.yml changed on disk since we parsed it, drop the cache so the next read
  // reflects the edit with no server restart (dev iteration; `tsx watch` can't see this file because
  // it isn't imported). Stat at most once per second, so a burst of config reads within one request
  // costs a single stat. A create/edit/delete all change what statSync returns and trigger a reload.
  if (cachedFile !== undefined && now - lastStatMs >= STAT_THROTTLE_MS) {
    lastStatMs = now;
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(filePath).mtimeMs;
    } catch {
      mtimeMs = 0; // gone
    }
    if (mtimeMs !== cachedMtimeMs) cachedFile = undefined;
  }

  if (cachedFile === undefined) {
    lastStatMs = now;
    cachedFile = loadFile(filePath);
    cachedMtimeMs = cachedFile === null ? 0 : fs.statSync(filePath).mtimeMs;
  }
  return cachedFile ?? {};
}

/** Test-only: forget the parsed file so a later call re-reads it (used by config's own tests). */
export function __resetConfigCacheForTests(): void {
  cachedFile = undefined;
  cachedMtimeMs = 0;
  lastStatMs = 0;
}

// --- Resolution helpers (env > file > default). `pick` reads the value out of the parsed file. ---

/** A required string: env wins, then the file, then `fallback`. Blank/whitespace env or file values
 *  are treated as "unset" so an empty override never blanks out a real default. */
export function strConfig(envName: string, pick: (c: FileConfig) => string | undefined, fallback: string): string {
  const env = process.env[envName];
  if (env !== undefined && env.trim() !== "") return env;
  const fromFile = pick(fileConfig());
  return fromFile !== undefined && fromFile !== "" ? fromFile : fallback;
}

/** An optional string: env, then file, then undefined. */
export function optStrConfig(envName: string, pick: (c: FileConfig) => string | undefined): string | undefined {
  const env = process.env[envName];
  if (env !== undefined && env.trim() !== "") return env;
  const fromFile = pick(fileConfig());
  return fromFile && fromFile !== "" ? fromFile : undefined;
}

/** A boolean: if the env var is present at all it decides (true only for the exact string "true");
 *  otherwise the file's boolean, otherwise `fallback`. */
export function boolConfig(envName: string, pick: (c: FileConfig) => boolean | undefined, fallback: boolean): boolean {
  const env = process.env[envName];
  if (env !== undefined) return env === "true";
  const fromFile = pick(fileConfig());
  return typeof fromFile === "boolean" ? fromFile : fallback;
}

/** A positive integer: a valid positive env value wins, else a positive file number, else `fallback`. */
export function intConfig(envName: string, pick: (c: FileConfig) => number | undefined, fallback: number): number {
  const env = process.env[envName];
  if (env !== undefined) {
    const n = Number(env);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  const fromFile = pick(fileConfig());
  return typeof fromFile === "number" && fromFile > 0 ? Math.floor(fromFile) : fallback;
}
