import "../env.js"; // load .env before any config value (incl. CONFIG_FILE) is read, regardless of import order
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { REPO_ROOT } from "../paths.js";
import { FileConfigSchema, type FileConfig } from "./schema.js";

// config.yml lives at the repo root next to .env. Resolve it from REPO_ROOT (the same way env.ts
// resolves .env), NOT process.cwd(): the server runs with cwd = apps/server (it's launched via the
// `npm run dev --workspace=apps/server` workspace script), so a cwd-relative lookup silently misses
// the repo-root file and every config.yml value falls back to its default.
export const DEFAULT_CONFIG_PATH = path.join(REPO_ROOT, "config.yml");

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

// --- Change reporting -----------------------------------------------------------------------
// The loader is lazy: an edit is noticed on the first config read after it, not at the moment of
// the save. So these lines mark when the new values actually went live, which is the fact an
// operator needs in order to line the change up against a request. The first load stays silent —
// only a change after the process started is news.

let reloadedFromMtimeMs: number | null = null; // mtime the cache held when a change was detected
let reportedInvalidMtimeMs: number | null = null; // file version already reported as invalid

/** mtime of `filePath` in ms, or 0 when no file is there. */
function statMtimeMs(filePath: string): number {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0; // gone (or unreadable): treat it as "no file", the same as loadFile does
  }
}

/** Report a reload that already succeeded. */
function reportReload(filePath: string): void {
  const from = reloadedFromMtimeMs;
  const wasInvalid = reportedInvalidMtimeMs !== null;
  reloadedFromMtimeMs = null;
  reportedInvalidMtimeMs = null;

  // Was a file there before this load? `from` holds the mtime the cache carried when a change was
  // detected (0 meaning "no file then"), and `wasInvalid` means a file was there and we complained
  // about it. Either one proves a file existed.
  const hadFile = (from !== null && from !== 0) || wasInvalid;

  // "Gone" is decided FIRST, before `wasInvalid`. An operator who saves a broken config and then
  // deletes it satisfies both conditions, and answering with "valid again ... the new values are
  // live" describes a file that no longer exists — the opposite of what happened.
  if (cachedMtimeMs === 0) {
    if (hadFile) {
      console.log(`[orbis] config file removed (${filePath}). Environment values and defaults now apply.`);
    }
    return; // no file now and none before: the first load of a run, which stays silent
  }

  if (wasInvalid) {
    console.log(`[orbis] config file is valid again (${filePath}). The new values are live.`);
  } else if (from === null) {
    return; // first load of the run, not a change
  } else if (from === 0) {
    console.log(`[orbis] config file created (${filePath}). The new values are live.`);
  } else {
    console.log(`[orbis] config file changed (${filePath}). The new values are live.`);
  }
}

/** Report a load that failed. The caller still throws. One warning per file version: without the
 *  mtime guard, every request repeats the same block until an operator corrects the file. */
function reportInvalid(filePath: string, err: unknown): void {
  const mtimeMs = statMtimeMs(filePath);
  if (mtimeMs === reportedInvalidMtimeMs) return;
  reportedInvalidMtimeMs = mtimeMs;
  const what = reloadedFromMtimeMs === null ? "config file is invalid" : "config file changed, but it is invalid";
  console.warn(`[orbis] ${what}. Config reads fail until you correct it.\n${err instanceof Error ? err.message : String(err)}`);
}

/** Read + validate the file at `filePath` (null if it doesn't exist). Throws on invalid content. */
function loadFile(filePath: string): FileConfig | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = (parseYaml(fs.readFileSync(filePath, "utf-8")) ?? {}) as unknown;
  const parsed = FileConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`[orbis] Invalid config file at ${filePath}:\n${details}`);
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
    const mtimeMs = statMtimeMs(filePath);
    if (mtimeMs !== cachedMtimeMs) {
      reloadedFromMtimeMs = cachedMtimeMs; // remember the old version, so the log can name the change
      cachedFile = undefined;
    }
  }

  if (cachedFile === undefined) {
    lastStatMs = now;
    // Stat BEFORE reading, and stamp the cache with that value. Statting afterwards pairs the bytes
    // we read with an mtime that may already belong to a NEWER save — an editor that writes a file
    // in several steps can land one between the two calls. The check above then compares against
    // that newer mtime forever, so the edit is never noticed and stays lost until a restart.
    // Stamping with the pre-read mtime is self-correcting: if a save did land during the read, the
    // file's real mtime no longer matches the stamp, and the next check reloads.
    const mtimeBeforeRead = statMtimeMs(filePath);
    let loaded: FileConfig | null;
    try {
      loaded = loadFile(filePath);
    } catch (err) {
      reportInvalid(filePath, err);
      throw err;
    }
    cachedFile = loaded;
    // statMtimeMs, not fs.statSync: the file can be deleted between loadFile's read and this line,
    // and a raw statSync would throw out of a plain config read.
    cachedMtimeMs = loaded === null ? 0 : mtimeBeforeRead;
    reportReload(filePath);
  }
  return cachedFile ?? {};
}

/** Re-read the file now, so a watcher's report lands at save time. The load path already reports a
 *  failure, so swallow the error here: an uncaught throw inside a watch callback kills the server. */
function refreshNow(): void {
  lastStatMs = 0; // the edit is already known, so do not wait out the stat throttle
  try {
    fileConfig();
  } catch {
    /* reportInvalid warned about it */
  }
}

/**
 * Watch the config file and report a change as it happens, instead of on the next config read.
 * Call it once, from the server entry point. Returns a function that stops the watch.
 *
 * Without this, the report is only as prompt as the next request: an operator who saves the file
 * and watches the terminal sees nothing until something reads the config.
 */
export function watchConfigFile(): () => void {
  const filePath = resolveConfigPath();
  const dir = path.dirname(filePath);
  const name = path.basename(filePath);
  let timer: NodeJS.Timeout | undefined;
  let watcher: fs.FSWatcher;

  try {
    // Watch the directory, not the file. An editor that saves by writing a temporary file and
    // renaming it over the original replaces the directory entry, and a watch on the file itself
    // then reports nothing more. A directory watch also sees the file created or deleted.
    watcher = fs.watch(dir, { persistent: false }, (_event, changed) => {
      if (changed !== null && changed !== name) return;
      // One save fires several events. Coalesce them, so one edit prints one line.
      clearTimeout(timer);
      timer = setTimeout(refreshNow, 150);
      timer.unref?.();
    });
  } catch (err) {
    console.warn(`[orbis] cannot watch ${dir} for config changes: ${err instanceof Error ? err.message : String(err)}`);
    return () => {};
  }

  watcher.on("error", (err) => console.warn(`[orbis] config watch stopped: ${err.message}`));
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}

/** Test-only: forget the parsed file so a later call re-reads it (used by config's own tests). */
export function __resetConfigCacheForTests(): void {
  cachedFile = undefined;
  cachedMtimeMs = 0;
  lastStatMs = 0;
  reloadedFromMtimeMs = null;
  reportedInvalidMtimeMs = null;
}

/** Test-only: age out the stat throttle so the next read checks the file at once. Keeps the cache,
 *  which is what makes a hot-reload testable without a real one-second wait. */
export function __expireStatThrottleForTests(): void {
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
