import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SERVER_ROOT, REPO_ROOT, PROMPTS_DIR, WEB_DIST, WEB_SRC_INDEX_HTML } from "./paths.js";

// Every export in paths.ts is derived from this file's own directory, so moving paths.ts shifts all
// of them at once. Each assertion below checks the resolved path against an independent on-disk
// marker rather than re-deriving the module's own "../" arithmetic: re-deriving would only prove
// the code equals itself and would stay green after such a move. The prompt modules read from
// PROMPTS_DIR at import time, so without these tests the first symptom is an ENOENT at server boot.

test("SERVER_ROOT resolves to the apps/server package, identified by its package.json name", () => {
  const pkgPath = path.join(SERVER_ROOT, "package.json");
  assert.ok(fs.existsSync(pkgPath), `expected a package.json at SERVER_ROOT, got ${SERVER_ROOT}`);
  const pkg: unknown = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  assert.equal((pkg as { name?: string }).name, "@flipbook/server");
});

test("REPO_ROOT resolves to the monorepo root, identified by root-only files", () => {
  for (const marker of ["package-lock.json", "config.example.yml"]) {
    assert.ok(
      fs.existsSync(path.join(REPO_ROOT, marker)),
      `expected the repo-root ${marker} under REPO_ROOT, got ${REPO_ROOT}`,
    );
  }
});

test("PROMPTS_DIR points at the real system prompts, not an empty or missing directory", () => {
  assert.ok(fs.existsSync(PROMPTS_DIR), `PROMPTS_DIR does not exist: ${PROMPTS_DIR}`);
  const prompts = fs.readdirSync(PROMPTS_DIR).filter((f) => f.endsWith(".md"));
  assert.ok(prompts.length > 0, `no .md prompts found in ${PROMPTS_DIR}`);
});

test("WEB_SRC_INDEX_HTML points at the web app's source index.html", () => {
  assert.ok(fs.existsSync(WEB_SRC_INDEX_HTML), `missing web index.html: ${WEB_SRC_INDEX_HTML}`);
});

// WEB_DIST is a build output, so its existence depends on whether `npm run build` has run. Pin only
// its location, using the web package.json as the marker for the directory it must sit inside.
test("WEB_DIST resolves inside the web package", () => {
  assert.equal(path.basename(WEB_DIST), "dist");
  const webPkg = path.join(path.dirname(WEB_DIST), "package.json");
  assert.ok(fs.existsSync(webPkg), `expected WEB_DIST inside the web package, got ${WEB_DIST}`);
});
