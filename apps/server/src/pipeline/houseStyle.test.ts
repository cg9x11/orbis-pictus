import { test } from "node:test";
import assert from "node:assert/strict";
import { buildImagePrompt, getHouseStyleBlock, listHouseStyles } from "./houseStyle.js";

test("default style (no HOUSE_STYLE env) is felt", () => {
  delete process.env.HOUSE_STYLE;
  assert.match(getHouseStyleBlock(), /needle-felted wool/);
});

test("HOUSE_STYLE selects an alternate style block", () => {
  const prev = process.env.HOUSE_STYLE;
  try {
    process.env.HOUSE_STYLE = "papercut";
    assert.match(getHouseStyleBlock(), /layered cut-paper/);
    assert.doesNotMatch(getHouseStyleBlock(), /needle-felted wool/);

    process.env.HOUSE_STYLE = "riso";
    assert.match(getHouseStyleBlock(), /risograph/);

    process.env.HOUSE_STYLE = "pixel";
    assert.match(getHouseStyleBlock(), /pixel art/);
  } finally {
    if (prev === undefined) delete process.env.HOUSE_STYLE;
    else process.env.HOUSE_STYLE = prev;
  }
});

test("an unrecognized HOUSE_STYLE value falls back to felt", () => {
  const prev = process.env.HOUSE_STYLE;
  try {
    process.env.HOUSE_STYLE = "not-a-real-style";
    assert.match(getHouseStyleBlock(), /needle-felted wool/);
  } finally {
    if (prev === undefined) delete process.env.HOUSE_STYLE;
    else process.env.HOUSE_STYLE = prev;
  }
});

// The picker lets a style be chosen per request, so it must win over the server's env default —
// otherwise switching style in the UI would silently keep rendering the old look.
test("an explicit style argument overrides the HOUSE_STYLE env", () => {
  const prev = process.env.HOUSE_STYLE;
  try {
    process.env.HOUSE_STYLE = "felt";
    assert.match(getHouseStyleBlock("riso"), /risograph/);
    assert.doesNotMatch(getHouseStyleBlock("riso"), /needle-felted wool/);
    assert.match(buildImagePrompt("A page about cats.", "pixel"), /pixel art/);
  } finally {
    if (prev === undefined) delete process.env.HOUSE_STYLE;
    else process.env.HOUSE_STYLE = prev;
  }
});

// A bad value from a stale client must render the house look, never fail the generation.
test("an unrecognized explicit style falls back to the server default", () => {
  const prev = process.env.HOUSE_STYLE;
  try {
    process.env.HOUSE_STYLE = "papercut";
    assert.match(getHouseStyleBlock("no-such-style"), /layered cut-paper/);
    assert.match(getHouseStyleBlock(undefined), /layered cut-paper/);
  } finally {
    if (prev === undefined) delete process.env.HOUSE_STYLE;
    else process.env.HOUSE_STYLE = prev;
  }
});

// Labels come from each section's own "## Style: …" heading, so the picker cannot drift out of
// sync with the prompt text it selects.
test("listHouseStyles reports every style with a label taken from house-style.md", () => {
  const styles = listHouseStyles();
  assert.deepEqual(
    styles.map((s) => s.name),
    ["felt", "papercut", "riso", "pixel"],
  );
  assert.equal(styles[0]?.label, "Needle-felted wool");
  for (const style of styles) {
    assert.ok(style.label.length > 0, `${style.name} should have a label`);
    assert.doesNotMatch(style.label, /^##/, "the markdown heading marker should be stripped");
  }
});

test("the house style block is always included in the layout contract", () => {
  assert.match(getHouseStyleBlock(), /isometric three-quarter aerial view/);
});

test("buildImagePrompt appends the house style block after the content prompt", () => {
  const built = buildImagePrompt("A page about cats.");
  assert.match(built, /^A page about cats\./);
  assert.equal(built, `A page about cats.\n\n${getHouseStyleBlock()}`);
});
