import type { AspectRatio } from "@flipbook/shared";

/** ~4% grid (layer 1): cell = round(ratio * 24). */
export const TAP_CACHE_GRID = 24;

export function tapCellIndex(ratio: number): number {
  return Math.round(ratio * TAP_CACHE_GRID);
}

/** The cell and its 8 neighbors ("check the cell and its 8 neighboring cells"). */
export function neighborCells(cell: number): number[] {
  return [cell - 1, cell, cell + 1];
}

// Proportions only (not pixel dimensions) — the tap-cache radius must be a pure function
// independent of the actual rendered image size, which varies by provider (mock vs. Ark).
const ASPECT_PROPORTIONS: Record<AspectRatio, [number, number]> = {
  "16:9": [16, 9],
  "3:4": [3, 4],
  "1:1": [1, 1],
};

/** Matches the visual tap marker: radius = 8.5% of the image's min dimension. */
const TAP_RADIUS_FRACTION = 0.085;

/**
 * The marker radius expressed as a fraction of image width (rx) and height (ry), derived from
 * the aspect ratio's proportions alone. A real pixel-space radius R (= 0.085 * min(w,h)) maps to
 * an ellipse in normalized ratio-space with radii R/w and R/h — that's what these are.
 */
export function tapRadiusRatios(aspectRatio: AspectRatio): { rx: number; ry: number } {
  const [w, h] = ASPECT_PROPORTIONS[aspectRatio];
  const minDim = Math.min(w, h);
  return { rx: (TAP_RADIUS_FRACTION * minDim) / w, ry: (TAP_RADIUS_FRACTION * minDim) / h };
}

/**
 * Whether (x2,y2) falls under the same tap marker as (x1,y1) — i.e. within the visual circle's
 * radius, honestly matching "anything under the same circle is the same click".
 * Coordinates are normalized [0,1] fractions of image width/height.
 */
export function isWithinTapRadius(aspectRatio: AspectRatio, x1: number, y1: number, x2: number, y2: number): boolean {
  const { rx, ry } = tapRadiusRatios(aspectRatio);
  const dx = (x2 - x1) / rx;
  const dy = (y2 - y1) / ry;
  return dx * dx + dy * dy <= 1;
}
