import "../env.js"; // load .env before any config value (incl. CONFIG_FILE) is read, regardless of import order
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { FileConfigSchema, type FileConfig } from "./schema.js";

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

function fileConfig(): FileConfig {
  if (cachedFile === undefined) {
    const filePath = process.env.CONFIG_FILE?.trim() || path.resolve(process.cwd(), "config.yml");
    if (!fs.existsSync(filePath)) {
      cachedFile = null;
    } else {
      const raw = (parseYaml(fs.readFileSync(filePath, "utf-8")) ?? {}) as unknown;
      const parsed = FileConfigSchema.safeParse(raw);
      if (!parsed.success) {
        const details = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
        throw new Error(`[flipbook] Invalid config file at ${filePath}:\n${details}`);
      }
      cachedFile = parsed.data;
    }
  }
  return cachedFile ?? {};
}

/** Test-only: forget the parsed file so a later call re-reads it (used by config's own tests). */
export function __resetConfigCacheForTests(): void {
  cachedFile = undefined;
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
