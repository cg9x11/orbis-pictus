import { test } from "node:test";
import assert from "node:assert/strict";
import { buildImagePrompt, getArtStyleBlock, listArtStyles, listCompositions } from "./artStyle.js";

test("default style (no ART_STYLE env) is felt", () => {
  delete process.env.ART_STYLE;
  assert.match(getArtStyleBlock(), /needle-felted wool/);
});

test("ART_STYLE selects an alternate style block", () => {
  const prev = process.env.ART_STYLE;
  try {
    process.env.ART_STYLE = "papercut";
    assert.match(getArtStyleBlock(), /layered cut-paper/);
    assert.doesNotMatch(getArtStyleBlock(), /needle-felted wool/);

    process.env.ART_STYLE = "riso";
    assert.match(getArtStyleBlock(), /risograph/);

    process.env.ART_STYLE = "pixel";
    assert.match(getArtStyleBlock(), /pixel art/);

    process.env.ART_STYLE = "editorial";
    assert.match(getArtStyleBlock(), /editorial illustration/);
  } finally {
    if (prev === undefined) delete process.env.ART_STYLE;
    else process.env.ART_STYLE = prev;
  }
});

test("an unrecognized ART_STYLE value falls back to felt", () => {
  const prev = process.env.ART_STYLE;
  try {
    process.env.ART_STYLE = "not-a-real-style";
    assert.match(getArtStyleBlock(), /needle-felted wool/);
  } finally {
    if (prev === undefined) delete process.env.ART_STYLE;
    else process.env.ART_STYLE = prev;
  }
});

// The picker lets a style be chosen per request, so it must win over the server's env default —
// otherwise switching style in the UI would silently keep rendering the old look.
test("an explicit style argument overrides the ART_STYLE env", () => {
  const prev = process.env.ART_STYLE;
  try {
    process.env.ART_STYLE = "felt";
    assert.match(getArtStyleBlock("riso"), /risograph/);
    assert.doesNotMatch(getArtStyleBlock("riso"), /needle-felted wool/);
    assert.match(buildImagePrompt("A page about cats.", "pixel"), /pixel art/);
  } finally {
    if (prev === undefined) delete process.env.ART_STYLE;
    else process.env.ART_STYLE = prev;
  }
});

// A bad value from a stale client must render the house look, never fail the generation.
test("an unrecognized explicit style falls back to the server default", () => {
  const prev = process.env.ART_STYLE;
  try {
    process.env.ART_STYLE = "papercut";
    assert.match(getArtStyleBlock("no-such-style"), /layered cut-paper/);
    assert.match(getArtStyleBlock(undefined), /layered cut-paper/);
  } finally {
    if (prev === undefined) delete process.env.ART_STYLE;
    else process.env.ART_STYLE = prev;
  }
});

// Labels come from each section's own "## Style: …" heading, so the picker cannot drift out of
// sync with the prompt text it selects.
test("listArtStyles reports every style with a label taken from art-style.md", () => {
  const styles = listArtStyles();
  assert.deepEqual(
    styles.map((s) => s.name),
    ["felt", "papercut", "riso", "pixel", "editorial"],
  );
  assert.equal(styles[0]?.label, "Needle-felted wool");
  for (const style of styles) {
    assert.ok(style.label.length > 0, `${style.name} should have a label`);
    assert.doesNotMatch(style.label, /^##/, "the markdown heading marker should be stripped");
  }
});

test("the art style block is always included in the layout contract", () => {
  // The layout-furniture cap survives in every block; the isometric phrase now lives in the diorama
  // composition, which is the default composition, so getArtStyleBlock() (no args) still carries it.
  assert.match(getArtStyleBlock(), /five or six labelled elements/);
  assert.match(getArtStyleBlock(), /isometric three-quarter aerial view/);
});

// Composition is an axis orthogonal to style: the same style block renders flat or dioramic.
test("getArtStyleBlock selects the requested composition block", () => {
  const flat = getArtStyleBlock("felt", "flat");
  assert.match(flat, /flat, front-on educational infographic/i);
  assert.doesNotMatch(flat, /isometric three-quarter aerial view/);

  const diorama = getArtStyleBlock("felt", "diorama");
  assert.match(diorama, /isometric three-quarter aerial view/);
  assert.doesNotMatch(diorama, /flat, front-on educational infographic/i);

  // "isometric" is the third pole: axonometric projection without the miniature-diorama framing.
  // Anchored on the section heading rather than a phrase from its prose: this block is the app's
  // main visual lever and gets reworded often, and a prose marker turned every tuning pass into a
  // test edit — which says nothing about whether the selector picked the right block.
  const isometric = getArtStyleBlock("felt", "isometric");
  assert.match(isometric, /## Composition: isometric diagram/i);
  assert.doesNotMatch(isometric, /isometric three-quarter aerial view/);
});

test("an unrecognized composition falls back to the default (diorama)", () => {
  assert.match(getArtStyleBlock("felt", "no-such-composition"), /isometric three-quarter aerial view/);
});

test("listCompositions reports flat and diorama with labels from art-style.md", () => {
  const comps = listCompositions();
  assert.deepEqual(
    comps.map((c) => c.name),
    ["flat", "isometric", "diorama"],
  );
  for (const comp of comps) {
    assert.ok(comp.label.length > 0, `${comp.name} should have a label`);
    assert.doesNotMatch(comp.label, /^##/, "the markdown heading marker should be stripped");
  }
});

test("buildImagePrompt threads the composition through to the built prompt", () => {
  assert.match(buildImagePrompt("A page about cats.", "felt", { composition: "flat" }), /flat, front-on educational infographic/i);
  assert.match(buildImagePrompt("A page about cats.", "felt", { composition: "diorama" }), /isometric three-quarter aerial view/);
});

// Proven order for modern image models: framing -> style -> quality -> `Content:`.
test("buildImagePrompt wraps content: framing first, art style embedded, content last", () => {
  const built = buildImagePrompt("A page about cats.");
  assert.match(built, /^You can generate a new visual article expanding on the chosen topic/, "framing leads");
  assert.ok(built.includes(getArtStyleBlock()), "embeds the art style block");
  assert.match(built, /\nContent: A page about cats\.$/, "content comes last, after the Content: marker");
});

// The reference-reuse clause is what keeps tap/edit continuity (parent scene as the base); search,
// which carries no reference image, must not ask for it.
test("buildImagePrompt requests reference reuse only when a reference image is provided", () => {
  assert.match(buildImagePrompt("A page about cats.", undefined, { reference: "reuse" }), /reference image is provided/i);
  assert.doesNotMatch(buildImagePrompt("A page about cats.", undefined, { reference: "none" }), /reference image is provided/i);
  assert.doesNotMatch(buildImagePrompt("A page about cats."), /reference image is provided/i);
});
