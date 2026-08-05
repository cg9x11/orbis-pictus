import { test } from "node:test";
import assert from "node:assert/strict";
import { buildImagePrompt, getHouseStyleBlock } from "./houseStyle.js";

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

test("the house style block is always included in the layout contract", () => {
  assert.match(getHouseStyleBlock(), /isometric three-quarter aerial view/);
});

test("buildImagePrompt appends the house style block after the content prompt", () => {
  const built = buildImagePrompt("A page about cats.");
  assert.match(built, /^A page about cats\./);
  assert.equal(built, `A page about cats.\n\n${getHouseStyleBlock()}`);
});
