import type { AspectRatio } from "./schema.js";

/** ~4% grid (layer 1): cell = round(ratio * 24). */
export const TAP_CACHE_GRID = 24;

export function tapCellIndex(ratio: number): number {
  return Math.round(ratio * TAP_CACHE_GRID);
}

// These are proportions, not pixel dimensions. The tap-cache radius must be a pure function.
// It cannot depend on the rendered image size, which changes with the provider (mock or Ark).
const ASPECT_PROPORTIONS: Record<AspectRatio, [number, number]> = {
  "16:9": [16, 9],
  "3:4": [3, 4],
  "1:1": [1, 1],
};

/** Matches the visual tap marker. The radius is 8.5% of the minimum image dimension. */
const TAP_RADIUS_FRACTION = 0.085;

/**
 * The marker radius as a fraction of the image width (rx) and the image height (ry). Only the
 * proportions of the aspect ratio determine these two values.
 *
 * A pixel-space radius R (= 0.085 * min(w,h)) maps to an ellipse in normalized ratio-space. That
 * ellipse has the radii R/w and R/h. Those radii are rx and ry.
 */
export function tapRadiusRatios(aspectRatio: AspectRatio): { rx: number; ry: number } {
  const [w, h] = ASPECT_PROPORTIONS[aspectRatio];
  const minDim = Math.min(w, h);
  return { rx: (TAP_RADIUS_FRACTION * minDim) / w, ry: (TAP_RADIUS_FRACTION * minDim) / h };
}

/**
 * Returns true when (x2,y2) falls under the same tap marker as (x1,y1). That is, the point is
 * within the radius of the visual circle. Anything under the same circle is the same click. The
 * coordinates are normalized [0,1] fractions of the image width and the image height.
 *
 * This function is in the shared package because both sides must agree on it. The server uses it
 * for the layer-1 cache lookup. The web client uses it to decide whether a tap lands on an
 * already-explored spot, before the client spends anything. Two separate implementations drift
 * apart over time.
 */
export function isWithinTapRadius(aspectRatio: AspectRatio, x1: number, y1: number, x2: number, y2: number): boolean {
  const { rx, ry } = tapRadiusRatios(aspectRatio);
  const dx = (x2 - x1) / rx;
  const dy = (y2 - y1) / ry;
  return dx * dx + dy * dy <= 1;
}
