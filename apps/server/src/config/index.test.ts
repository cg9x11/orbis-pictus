import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  strConfig,
  optStrConfig,
  boolConfig,
  intConfig,
  resolveConfigPath,
  DEFAULT_CONFIG_PATH,
  __resetConfigCacheForTests,
  __expireStatThrottleForTests,
  watchConfigFile,
} from "./index.js";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbis-config-"));

/** Point the loader at a fresh YAML file (or none) and clear the parse cache, so each scenario is isolated. */
function useConfig(yamlText: string | null): void {
  if (yamlText === null) {
    process.env.CONFIG_FILE = path.join(tmpDir, "does-not-exist.yml");
  } else {
    const p = path.join(tmpDir, `cfg-${Math.random().toString(36).slice(2)}.yml`);
    fs.writeFileSync(p, yamlText);
    process.env.CONFIG_FILE = p;
  }
  __resetConfigCacheForTests();
}

// Env vars the tests toggle - cleared before each use so a leaked value can't mask a bug.
const ENVS = ["CFG_STR", "CFG_BOOL", "CFG_INT"];
function clearEnv(): void {
  for (const k of ENVS) delete process.env[k];
}

test("precedence: env var wins over the file, which wins over the default", () => {
  useConfig(`artStyle: papercut`);
  clearEnv();
  // no env -> file value
  assert.equal(strConfig("CFG_STR", (c) => c.artStyle, "felt"), "papercut");
  // env set -> env wins
  process.env.CFG_STR = "riso";
  assert.equal(strConfig("CFG_STR", (c) => c.artStyle, "felt"), "riso");
  clearEnv();
});

test("strConfig falls back to the default when neither env nor file provides a value", () => {
  useConfig(`artStyle: papercut`);
  clearEnv();
  // file has artStyle but this picker reads composition, which is absent -> default
  assert.equal(strConfig("CFG_STR", (c) => c.composition, "diorama"), "diorama");
});

test("strConfig treats a blank env value as unset (does not blank out a real default)", () => {
  useConfig(null);
  clearEnv();
  process.env.CFG_STR = "   ";
  assert.equal(strConfig("CFG_STR", (c) => c.artStyle, "felt"), "felt");
  clearEnv();
});

test("optStrConfig returns undefined when unset in both env and file", () => {
  useConfig(`video:\n  morph:\n    model: my-morph-model`);
  clearEnv();
  assert.equal(optStrConfig("CFG_STR", (c) => c.video?.morph?.model), "my-morph-model");
  assert.equal(optStrConfig("CFG_STR", (c) => c.image?.ark?.model), undefined);
});

test("boolConfig: env presence decides (only 'true' is true); else file boolean; else default", () => {
  useConfig(`video:\n  enabled: true`);
  clearEnv();
  assert.equal(boolConfig("CFG_BOOL", (c) => c.video?.enabled, false), true); // from file
  process.env.CFG_BOOL = "false";
  assert.equal(boolConfig("CFG_BOOL", (c) => c.video?.enabled, false), false); // env overrides file
  process.env.CFG_BOOL = "yes"; // anything but "true" is false
  assert.equal(boolConfig("CFG_BOOL", (c) => c.video?.enabled, false), false);
  clearEnv();
  useConfig(null);
  assert.equal(boolConfig("CFG_BOOL", (c) => c.video?.enabled, true), true); // default
});

test("intConfig: valid positive env wins, else positive file number, else default", () => {
  useConfig(`search:\n  timeoutMs: 1000`);
  clearEnv();
  assert.equal(intConfig("CFG_INT", (c) => c.search?.timeoutMs, 45000), 1000); // file
  process.env.CFG_INT = "2000";
  assert.equal(intConfig("CFG_INT", (c) => c.search?.timeoutMs, 45000), 2000); // env
  process.env.CFG_INT = "-5"; // invalid -> ignore env, fall to file
  assert.equal(intConfig("CFG_INT", (c) => c.search?.timeoutMs, 45000), 1000);
  clearEnv();
});

test("a missing config file is fine: everything falls back to env/default", () => {
  useConfig(null);
  clearEnv();
  assert.equal(strConfig("CFG_STR", (c) => c.artStyle, "felt"), "felt");
  assert.equal(boolConfig("CFG_BOOL", (c) => c.upload?.enabled, false), false);
  assert.equal(intConfig("CFG_INT", (c) => c.video?.maxPerSession, 5), 5);
});

test("a wrong-typed value in the file throws a helpful error at load", () => {
  useConfig(`video:\n  enabled: "yes"`); // enabled must be boolean, not a string
  clearEnv();
  assert.throws(() => strConfig("CFG_STR", (c) => c.artStyle, "felt"), /Invalid config file/);
});

test("an unknown top-level key in the file is rejected (strict), not silently ignored", () => {
  useConfig(`vidoe:\n  enabled: true`); // typo'd section name
  clearEnv();
  assert.throws(() => strConfig("CFG_STR", (c) => c.artStyle, "felt"), /Invalid config file/);
});

test("the default config path resolves to the repo root, not the server's cwd (regression)", () => {
  // The server runs with cwd = apps/server, but config.yml lives at the repo root next to .env.
  // Assert the resolved directory against independent markers (files only the repo root has)
  // instead of re-deriving the same "../.." expression the code uses: that would only prove the
  // code equals itself, and would stay green if the module and its target moved together.
  const rootDir = path.dirname(DEFAULT_CONFIG_PATH);
  assert.equal(path.basename(DEFAULT_CONFIG_PATH), "config.yml");
  for (const marker of ["package-lock.json", "config.example.yml"]) {
    assert.ok(
      fs.existsSync(path.join(rootDir, marker)),
      `config.yml must resolve next to the repo-root ${marker}, got ${DEFAULT_CONFIG_PATH}`,
    );
  }
  // Guard against regressing to a cwd/apps-server-relative lookup.
  assert.ok(!DEFAULT_CONFIG_PATH.includes(`${path.sep}apps${path.sep}server${path.sep}config.yml`));
});

test("resolveConfigPath honors CONFIG_FILE when set, else uses the repo-root default", () => {
  const prev = process.env.CONFIG_FILE;
  try {
    delete process.env.CONFIG_FILE;
    assert.equal(resolveConfigPath(), DEFAULT_CONFIG_PATH);
    process.env.CONFIG_FILE = path.join(tmpDir, "custom.yml");
    assert.equal(resolveConfigPath(), path.resolve(tmpDir, "custom.yml"));
  } finally {
    if (prev === undefined) delete process.env.CONFIG_FILE;
    else process.env.CONFIG_FILE = prev;
  }
});

// --- Hot-reload logging ---------------------------------------------------------------------

/** Point the loader at `p`, with a fresh cache, and capture console output while `body` runs. The
 *  live array is passed in, so a body can assert on what was logged so far. */
function captureLogs(p: string, body: (lines: string[]) => void): string[] {
  process.env.CONFIG_FILE = p;
  __resetConfigCacheForTests();
  clearEnv();
  const lines: string[] = [];
  const realLog = console.log;
  const realWarn = console.warn;
  console.log = (...args: unknown[]) => void lines.push(args.join(" "));
  console.warn = (...args: unknown[]) => void lines.push(args.join(" "));
  try {
    body(lines);
  } finally {
    console.log = realLog;
    console.warn = realWarn;
  }
  return lines;
}

/** Rewrite the file with a mtime the loader cannot mistake for the old one. Two writes inside the
 *  same file-system timestamp tick would otherwise look unchanged, and the test would flake. */
function rewrite(p: string, yamlText: string): void {
  fs.writeFileSync(p, yamlText);
  const distinct = new Date(Date.now() + 5000);
  fs.utimesSync(p, distinct, distinct);
}

const readStyle = (): string => strConfig("CFG_STR", (c) => c.artStyle, "felt");

/** Captured line `i`, with the presence check that indexing a string[] needs. */
function line(lines: string[], i: number): string {
  const value = lines[i];
  assert.ok(value !== undefined, `expected a log line at index ${i}, got ${lines.length} line(s)`);
  return value;
}

test("an edit to the config file is logged once, when the new values go live", () => {
  const p = path.join(tmpDir, "hot-edit.yml");
  fs.writeFileSync(p, `artStyle: papercut`);

  const lines = captureLogs(p, (log) => {
    assert.equal(readStyle(), "papercut");
    assert.deepEqual(log, [], "the first load of a run must stay silent");

    rewrite(p, `artStyle: riso`);
    __expireStatThrottleForTests();
    assert.equal(readStyle(), "riso"); // the read that makes the edit live is the read that logs
    assert.equal(log.length, 1);
    assert.match(line(log, 0), /config file changed/);

    // A later read finds the same file. It must not repeat the line.
    __expireStatThrottleForTests();
    assert.equal(readStyle(), "riso");
    assert.equal(log.length, 1);
  });
  assert.equal(lines.length, 1);
});

test("creating and removing the config file are logged with what now applies", () => {
  const p = path.join(tmpDir, "hot-create.yml");
  if (fs.existsSync(p)) fs.unlinkSync(p);

  const lines = captureLogs(p, () => {
    assert.equal(readStyle(), "felt"); // no file: the built-in default

    rewrite(p, `artStyle: papercut`);
    __expireStatThrottleForTests();
    assert.equal(readStyle(), "papercut");

    fs.unlinkSync(p);
    __expireStatThrottleForTests();
    assert.equal(readStyle(), "felt");
  });

  assert.equal(lines.length, 2);
  assert.match(line(lines, 0), /config file created/);
  assert.match(line(lines, 1), /config file removed/);
});

test("an invalid edit is warned about once, and the fix is logged", () => {
  const p = path.join(tmpDir, "hot-invalid.yml");
  fs.writeFileSync(p, `artStyle: papercut`);

  const lines = captureLogs(p, () => {
    assert.equal(readStyle(), "papercut");

    rewrite(p, `video:\n  enabled: "yes"`); // enabled must be a boolean
    __expireStatThrottleForTests();
    assert.throws(readStyle, /Invalid config file/);
    assert.throws(readStyle, /Invalid config file/); // still broken: the warning must not repeat

    rewrite(p, `artStyle: riso`);
    assert.equal(readStyle(), "riso");
  });

  assert.equal(lines.length, 2);
  assert.match(line(lines, 0), /config file changed, but it is invalid/);
  assert.match(line(lines, 1), /config file is valid again/);
});

test("deleting a config file that was invalid is reported as removed, not as fixed", () => {
  // Both conditions hold at once here: the file was reported invalid, AND it is now gone. Reporting
  // "valid again ... the new values are live" would name a file that does not exist and imply its
  // settings are in force, when in fact env values and defaults took over.
  const p = path.join(tmpDir, "hot-invalid-removed.yml");
  fs.writeFileSync(p, `artStyle: papercut`);

  const lines = captureLogs(p, () => {
    assert.equal(readStyle(), "papercut");

    rewrite(p, `video:\n  enabled: "yes"`); // enabled must be a boolean
    __expireStatThrottleForTests();
    assert.throws(readStyle, /Invalid config file/);

    fs.unlinkSync(p);
    __expireStatThrottleForTests();
    assert.equal(readStyle(), "felt"); // back to the built-in default
  });

  assert.equal(lines.length, 2);
  assert.match(line(lines, 0), /config file changed, but it is invalid/);
  assert.match(line(lines, 1), /config file removed/);
  assert.doesNotMatch(line(lines, 1), /valid again/);
});

test("the watcher reports a save without waiting for a config read", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbis-watch-"));
  const p = path.join(dir, "config.yml");
  fs.writeFileSync(p, `artStyle: papercut`);

  process.env.CONFIG_FILE = p;
  __resetConfigCacheForTests();
  clearEnv();

  const lines: string[] = [];
  const realLog = console.log;
  console.log = (...args: unknown[]) => void lines.push(args.join(" "));
  const stop = watchConfigFile();
  try {
    assert.equal(readStyle(), "papercut"); // the boot read, which primes the cache

    rewrite(p, `artStyle: riso`);
    // Nothing reads the config here. Only the watcher can produce a line.
    const deadline = Date.now() + 5000;
    while (lines.length === 0 && Date.now() < deadline) await sleep(50);

    assert.equal(lines.length, 1, "the save must produce exactly one line");
    assert.match(line(lines, 0), /config file changed/);
    assert.equal(readStyle(), "riso", "the watcher must also make the new value live");
  } finally {
    stop();
    console.log = realLog;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test("cleanup", () => {
  clearEnv();
  delete process.env.CONFIG_FILE;
  __resetConfigCacheForTests();
});
