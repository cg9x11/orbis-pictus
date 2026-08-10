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

// Policy change: a subtitle/tagline the renderer adds beside the title or caption used to be banned
// outright, because on Seedream 4.x any text the model wrote itself came out garbled. Modern models
// render it cleanly and it reads well, so only the supplied strings stay fixed — the decoration is
// welcome. These two tests now pin the new policy so it can't be re-tightened by accident.
test("art-style.md lets the renderer add its own supporting line near the title or caption", () => {
  assert.match(ART_STYLE, /supporting line of your own/i);
  assert.doesNotMatch(ART_STYLE, /title text\s+only/i);
});

test("art-style.md still pins the meaning-bearing strings as prompt-supplied and verbatim", () => {
  assert.match(ART_STYLE, /supplied\s+exactly by a prompt/i);
  assert.match(ART_STYLE, /must render verbatim/i);
});

test("page-author.md keeps image_prompt content-only: no style, palette, material, or lighting words requested from the LLM", () => {
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
  assert.match(ART_STYLE, /five or six labelled elements/i);
});

// The authoring prompts decide page content, so they have to carry the same policy as art-style.md
// above: the supplied title string is fixed, and a line the renderer adds beside it is not their
// problem to prevent. Anything they "fix" by instruction ends up fighting the renderer.
test("page-author.md and edit-author.md fix the supplied title string without banning a renderer-added line", () => {
  assert.match(PAGE_AUTHOR, /must render verbatim/i);
  assert.match(EDIT_AUTHOR, /must render verbatim/i);
  assert.doesNotMatch(PAGE_AUTHOR, /never author a subtitle/i);
  assert.doesNotMatch(EDIT_AUTHOR, /never add a subtitle|still add no second line/i);
});

// Seedream 4.x garbles combined Vietnamese tone-and-vowel marks, so proper nouns must be authored in
// plain ASCII ("Bui Vien", not "Bùi Viện") — verified against a real HCMC page where diacritics
// rendered as gibberish. Both authoring prompts must carry the rule.
test("page-author.md and edit-author.md require proper nouns in plain ASCII with diacritics removed", () => {
  assert.match(PAGE_AUTHOR, /diacritics removed/i);
  assert.match(EDIT_AUTHOR, /diacritics removed/i);
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
