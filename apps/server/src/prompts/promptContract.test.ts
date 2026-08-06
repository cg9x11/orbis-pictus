import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Reads the actual prompt markdown files sent to the LLM — pure text assertions, no API call.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGE_AUTHOR = fs.readFileSync(path.join(__dirname, "page-author.md"), "utf-8");
const EDIT_AUTHOR = fs.readFileSync(path.join(__dirname, "edit-author.md"), "utf-8");
const HOUSE_STYLE = fs.readFileSync(path.join(__dirname, "house-style.md"), "utf-8");

// The failure mode this guards against (PLAN §2 KNOWN OPEN ISSUE): asking the image model to
// stamp a sequential digit badge next to each callout ("numbered 1-6") reliably duplicates or
// skips a number, even though prose digits render fine. No prompt should instruct this — the old,
// now-removed phrasing looked exactly like this pattern (distinct from the new prose that merely
// *forbids* numeral badges, which legitimately contains those same words).
const NUMERAL_BADGE_POSITIVE_INSTRUCTION = /numbered\s+1-\d+/i;

test("page-author.md does not instruct the image model to draw numeral callout badges", () => {
  assert.doesNotMatch(PAGE_AUTHOR, NUMERAL_BADGE_POSITIVE_INSTRUCTION);
  assert.match(PAGE_AUTHOR, /never ask for a numeral badge|no numeral badges/i, "should explicitly forbid numeral badges");
});

test("edit-author.md does not instruct the image model to draw numeral callout badges", () => {
  assert.doesNotMatch(EDIT_AUTHOR, NUMERAL_BADGE_POSITIVE_INSTRUCTION);
  assert.match(EDIT_AUTHOR, /never introduce a numeral badge/i, "should explicitly forbid numeral badges");
});

test("page-author.md preserves ordering for sequential topics via arrow path + word-ordinals, not digits", () => {
  assert.match(PAGE_AUTHOR, /word-ordinals|Stage one/i);
});

test("house-style.md's title card carries the title only — no subtitle is described as a feature", () => {
  assert.match(HOUSE_STYLE, /no subtitle line/i);
  assert.doesNotMatch(HOUSE_STYLE, /subtitle line underneath the title|title.{0,20}subtitle.{0,20}(reads|shows)/i);
});

test("house-style.md states every text-bearing region must have prompt-supplied text, never invented", () => {
  assert.match(HOUSE_STYLE, /never text the image model has to invent|exact string supplied/i);
});

test("page-author.md keeps image_prompt content-only: no style, palette, material, or lighting words requested from the LLM", () => {
  assert.match(PAGE_AUTHOR, /never mention it|Do not write any style, palette, material, lighting/i);
});

// PLAN §2 (2026-08-06 post-launch fix): page-author.md previously told the author LLM to
// "Include 4 to 8" sub-topics while house-style.md capped the scene at "five or six labelled
// elements" — the contradiction let a 7-callout page ship where labels drifted onto the wrong
// descriptions. Both files must now agree on a 6-callout ceiling.
test("page-author.md and edit-author.md cap callouts at 6, matching house-style.md's scene-density limit", () => {
  assert.doesNotMatch(PAGE_AUTHOR, /4 to 8|4–8|4-8/);
  assert.match(PAGE_AUTHOR, /never more than 6|never exceed 6|4 to 6|4–6/i);
  assert.match(EDIT_AUTHOR, /never exceed 6|never more than 6/i);
  assert.match(HOUSE_STYLE, /five or six labelled elements/i);
});

// house-style.md forbids any subtitle under the title card, but a page-author prompt once wrote
// one in explicitly ("with a smaller line beneath reading...") and it rendered as garbled text —
// the ban must be mirrored in the prompts that actually decide page content, not left implicit.
test("page-author.md and edit-author.md explicitly forbid a subtitle line under the title card", () => {
  assert.match(PAGE_AUTHOR, /never author a subtitle|title text only/i);
  assert.match(EDIT_AUTHOR, /subtitle, tagline, byline/i);
});
