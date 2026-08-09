import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Reads the actual prompt markdown files sent to the LLM — pure text assertions, no API call.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGE_AUTHOR = fs.readFileSync(path.join(__dirname, "page-author.md"), "utf-8");
const EDIT_AUTHOR = fs.readFileSync(path.join(__dirname, "edit-author.md"), "utf-8");
const ART_STYLE = fs.readFileSync(path.join(__dirname, "art-style.md"), "utf-8");

test("page-author.md preserves ordering for sequential topics via a connecting arrow path", () => {
  assert.match(PAGE_AUTHOR, /continuous drawn arrow path/i);
});

// Layered page: the background image carries NO text at all — the title, every callout label, and
// the footer caption render as a DOM overlay on top of it instead. These two tests pin that policy
// so a future edit can't quietly reintroduce baked-in text (see PLAN-layered-page.md).
test("art-style.md instructs a completely clean scene, with margins left open for the overlay text", () => {
  assert.match(ART_STYLE, /NO text, letters, words, signs, plaques, or writing/i);
  assert.match(ART_STYLE, /leave open, uncluttered space/i);
});

test("art-style.md forbids drawing the title, labels, or caption — they render as a DOM overlay, not pixels", () => {
  assert.match(ART_STYLE, /app draws all of that itself/i);
  assert.doesNotMatch(ART_STYLE, /must render verbatim/i);
});

test("page-author.md keeps background_prompt content-only: no style, palette, material, or lighting words requested from the LLM", () => {
  assert.match(PAGE_AUTHOR, /never mention it|Do not write any style, palette, material, lighting/i);
});

// 2026-08-06 post-launch fix: page-author.md previously told the author LLM to
// "Include 4 to 8" sub-topics while art-style.md capped the scene at "five or six labelled
// elements" — the contradiction let a 7-callout page ship where labels drifted onto the wrong
// descriptions. Both files must now agree on a 6-callout ceiling.
test("page-author.md and edit-author.md cap callouts at 6, matching art-style.md's scene-density limit", () => {
  assert.doesNotMatch(PAGE_AUTHOR, /4 to 8|4–8|4-8/);
  assert.match(PAGE_AUTHOR, /never more than 6|never exceed 6|4 to 6|4–6/i);
  assert.match(EDIT_AUTHOR, /never exceed 6|never more than 6|no more than 6/i);
  assert.match(ART_STYLE, /four to six clearly distinct labelled subjects/i);
});

// The title and footer are DOM overlay text now, not pixels the image model draws — so the
// authoring prompts must say so explicitly, or a future edit could drift back to describing them
// inside background_prompt (which would make the image model draw them, and layer them under the
// real overlay text — see PLAN-layered-page.md, "Double text has no runtime handling").
test("page-author.md and edit-author.md render the title and footer as overlay text, not baked into background_prompt", () => {
  assert.match(PAGE_AUTHOR, /do not describe it in `background_prompt`/i);
  assert.match(EDIT_AUTHOR, /render.*separately as overlay text/i);
});

// Layered page retires the ASCII-diacritics-stripping workaround: labels/title/footer are real DOM
// text now, not pixels an image model has to draw, so there is nothing left to garble. Both
// authoring prompts must keep diacritics rather than stripping them (see memory
// diacritics-anti-example-prompting for the workaround this replaces).
test("page-author.md and edit-author.md keep diacritics on overlay text, retiring the ASCII-stripping workaround", () => {
  assert.match(PAGE_AUTHOR, /diacritics.*safe to keep/i);
  assert.match(EDIT_AUTHOR, /diacritics.*safe to keep/i);
  assert.doesNotMatch(PAGE_AUTHOR, /diacritics removed/i);
  assert.doesNotMatch(EDIT_AUTHOR, /diacritics removed/i);
});

// Seedream garbles invented/dense figures into gibberish (verified: an HCMC page rendered prices as
// "~$5U//pang" and "2Z,00,000 VND"). Both authoring prompts must forbid inventing them.
test("page-author.md and edit-author.md forbid invented prices/numbers and demand sparse text", () => {
  assert.match(PAGE_AUTHOR, /invent prices|do not invent/i);
  assert.match(EDIT_AUTHOR, /prices, phone numbers/i);
});

// The author LLM must ground page facts in the web search summary, not embellish beyond it — the
// summary is only one context line, so without this rule it freely invents plausible-looking names.
test("page-author.md constrains content to the web search summary's facts", () => {
  assert.match(PAGE_AUTHOR, /use ONLY the facts it contains|must come from that summary/i);
});
