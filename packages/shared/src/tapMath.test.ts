import { test } from "node:test";
import assert from "node:assert/strict";
import { tapCellIndex, tapRadiusRatios, isWithinTapRadius } from "./tapMath.js";

test("tapCellIndex quantizes to a 24-cell grid", () => {
  assert.equal(tapCellIndex(0), 0);
  assert.equal(tapCellIndex(1), 24);
  assert.equal(tapCellIndex(0.5), 12);
  assert.equal(tapCellIndex(0.501), 12);
});

test("tapRadiusRatios: min-dimension axis gets the full 8.5% radius", () => {
  const square = tapRadiusRatios("1:1");
  assert.ok(Math.abs(square.rx - 0.085) < 1e-9);
  assert.ok(Math.abs(square.ry - 0.085) < 1e-9);

  // Landscape: width is the larger dimension, so the same physical radius covers a smaller
  // fraction of width than of height.
  const landscape = tapRadiusRatios("16:9");
  assert.ok(landscape.ry > landscape.rx);
});

test("isWithinTapRadius accepts the exact same point", () => {
  assert.equal(isWithinTapRadius("16:9", 0.5, 0.5, 0.5, 0.5), true);
});

test("isWithinTapRadius accepts a point just inside the marker radius", () => {
  const { rx } = tapRadiusRatios("1:1");
  assert.equal(isWithinTapRadius("1:1", 0.5, 0.5, 0.5 + rx * 0.5, 0.5), true);
});

test("isWithinTapRadius rejects a point outside the marker radius", () => {
  const { rx } = tapRadiusRatios("1:1");
  assert.equal(isWithinTapRadius("1:1", 0.5, 0.5, 0.5 + rx * 1.5, 0.5), false);
});

test("isWithinTapRadius is anisotropic for non-square aspect ratios", () => {
  const { rx, ry } = tapRadiusRatios("16:9");
  // A point offset by 1.2x the (smaller) x-radius along x should miss...
  assert.equal(isWithinTapRadius("16:9", 0.5, 0.5, 0.5 + rx * 1.2, 0.5), false);
  // ...but the same absolute offset along y (well inside the larger y-radius) should hit.
  assert.equal(isWithinTapRadius("16:9", 0.5, 0.5, 0.5, 0.5 + rx * 1.2), true);
  assert.ok(ry > rx);
});
