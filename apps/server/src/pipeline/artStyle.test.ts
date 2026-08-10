import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildImagePrompt,
  getArtStyleBlock,
  listArtStyles,
  listCompositions,
  resolveCompositionForStyle,
  getConfiguredView,
  isViewLocked,
  AUTO_VIEW,
} from "./artStyle.js";

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
    ["felt", "papercut", "riso", "pixel", "editorial", "tiltshift"],
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

// Tilt-shift owns its own viewpoint: it must carry the photographic-camera language and drop the
// craft composition block entirely, no matter which composition is requested — an isometric or flat
// projection has no focal plane for the blur and fought the effect in testing.
test("tilt-shift style skips the composition block and brings its own camera", () => {
  const tilt = getArtStyleBlock("tiltshift", "diorama");
  assert.match(tilt, /shallow depth of field/);
  assert.match(tilt, /real\s+camera lens and natural perspective/i);
  // Guard the Seedream fix: the blur is described as optical depth of field, never a flat "band" —
  // the mechanical band wording made Seedream paint literal grey bars across the frame.
  assert.match(tilt, /never a flat band, bar, or darkened strip/);
  assert.doesNotMatch(tilt, /isometric three-quarter aerial view/);
  assert.doesNotMatch(tilt, /## Composition:/);
  // Even an explicit flat request is ignored — the style block is self-contained.
  assert.doesNotMatch(getArtStyleBlock("tiltshift", "flat"), /flat, front-on educational infographic/i);
});

// Per-provider prompt dialects: the same style is worded differently for models that read prompts
// differently. Gemini gets rich description; Seedream (ark) gets concise, imperative anti-artifact
// wording. A provider with no variant uses the base block.
test("tilt-shift serves a different prompt to each provider that has a variant", () => {
  const gemini = getArtStyleBlock("tiltshift", undefined, "gemini");
  const ark = getArtStyleBlock("tiltshift", undefined, "ark");
  assert.match(gemini, /creamy out-of-focus haze/);
  assert.match(ark, /do NOT draw any flat band, bar, gradient, or darkened strip/);
  assert.notEqual(gemini, ark);
});

test("a provider without a tilt-shift variant falls back to the base block", () => {
  const base = getArtStyleBlock("tiltshift");
  assert.equal(getArtStyleBlock("tiltshift", undefined, "openai"), base);
  assert.equal(getArtStyleBlock("tiltshift", undefined, undefined), base);
});

test("buildImagePrompt threads the drawing provider through to the per-provider style variant", () => {
  assert.match(buildImagePrompt("A page about cats.", "tiltshift", { provider: "ark" }), /do NOT draw any flat band/);
  assert.match(buildImagePrompt("A page about cats.", "tiltshift", { provider: "gemini" }), /creamy out-of-focus haze/);
});

// Auto view: "auto" (the default View) maps to each style's best-paired composition, so choosing a
// style loads a matching camera without the user picking one. An explicit view always overrides.
test("resolveCompositionForStyle maps 'auto' to each style's paired view", () => {
  assert.equal(resolveCompositionForStyle("felt", "auto"), "diorama");
  assert.equal(resolveCompositionForStyle("riso", "auto"), "flat");
  assert.equal(resolveCompositionForStyle("pixel", "auto"), "diorama");
  assert.equal(resolveCompositionForStyle("editorial", "auto"), "isometric");
  assert.equal(resolveCompositionForStyle("papercut", "auto"), "flat");
});

test("resolveCompositionForStyle: an explicit view overrides the auto pairing", () => {
  assert.equal(resolveCompositionForStyle("felt", "flat"), "flat");
  assert.equal(resolveCompositionForStyle("editorial", "diorama"), "diorama");
});

test("resolveCompositionForStyle: unknown or absent view falls back to the server default (diorama)", () => {
  assert.equal(resolveCompositionForStyle("felt", "no-such-view"), "diorama");
  assert.equal(resolveCompositionForStyle("felt", undefined), "diorama");
});

test("resolveCompositionForStyle: 'auto' with an unknown style uses the default style's pairing", () => {
  assert.equal(resolveCompositionForStyle("not-a-style", "auto"), AUTO_VIEW.felt);
});

// getConfiguredView is the UI's starting View, distinct from getDefaultCompositionName (the concrete
// fallback): it defaults to "auto" but passes an operator's COMPOSITION through, so `COMPOSITION=flat`
// makes the picker start on Flat again rather than silently on Auto.
test("getConfiguredView defaults to 'auto' and passes an explicit COMPOSITION through", () => {
  const prev = process.env.COMPOSITION;
  try {
    delete process.env.COMPOSITION;
    assert.equal(getConfiguredView(), "auto");
    process.env.COMPOSITION = "flat";
    assert.equal(getConfiguredView(), "flat");
  } finally {
    if (prev === undefined) delete process.env.COMPOSITION;
    else process.env.COMPOSITION = prev;
  }
});

test("isViewLocked is true only for styles that own their own camera", () => {
  assert.equal(isViewLocked("tiltshift"), true);
  assert.equal(isViewLocked("felt"), false);
  assert.equal(isViewLocked("editorial"), false);
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
