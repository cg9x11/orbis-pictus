import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strConfig, optStrConfig, boolConfig, intConfig, __resetConfigCacheForTests } from "./index.js";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "flipbook-config-"));

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

// Env vars the tests toggle — cleared before each use so a leaked value can't mask a bug.
const ENVS = ["CFG_STR", "CFG_BOOL", "CFG_INT"];
function clearEnv(): void {
  for (const k of ENVS) delete process.env[k];
}

test("precedence: env var wins over the file, which wins over the default", () => {
  useConfig(`houseStyle: papercut`);
  clearEnv();
  // no env -> file value
  assert.equal(strConfig("CFG_STR", (c) => c.houseStyle, "felt"), "papercut");
  // env set -> env wins
  process.env.CFG_STR = "riso";
  assert.equal(strConfig("CFG_STR", (c) => c.houseStyle, "felt"), "riso");
  clearEnv();
});

test("strConfig falls back to the default when neither env nor file provides a value", () => {
  useConfig(`houseStyle: papercut`);
  clearEnv();
  // file has houseStyle but this picker reads composition, which is absent -> default
  assert.equal(strConfig("CFG_STR", (c) => c.composition, "diorama"), "diorama");
});

test("strConfig treats a blank env value as unset (does not blank out a real default)", () => {
  useConfig(null);
  clearEnv();
  process.env.CFG_STR = "   ";
  assert.equal(strConfig("CFG_STR", (c) => c.houseStyle, "felt"), "felt");
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
  assert.equal(strConfig("CFG_STR", (c) => c.houseStyle, "felt"), "felt");
  assert.equal(boolConfig("CFG_BOOL", (c) => c.upload?.enabled, false), false);
  assert.equal(intConfig("CFG_INT", (c) => c.video?.maxPerSession, 5), 5);
});

test("a wrong-typed value in the file throws a helpful error at load", () => {
  useConfig(`video:\n  enabled: "yes"`); // enabled must be boolean, not a string
  clearEnv();
  assert.throws(() => strConfig("CFG_STR", (c) => c.houseStyle, "felt"), /Invalid config file/);
});

test("an unknown top-level key in the file is rejected (strict), not silently ignored", () => {
  useConfig(`vidoe:\n  enabled: true`); // typo'd section name
  clearEnv();
  assert.throws(() => strConfig("CFG_STR", (c) => c.houseStyle, "felt"), /Invalid config file/);
});

test("cleanup", () => {
  clearEnv();
  delete process.env.CONFIG_FILE;
  __resetConfigCacheForTests();
});
