import { imageToCanvas } from "./canvas";

/**
 * Draws the current page image with a tap marker at the given point, exactly per PLAN §1.3:
 * red (#ff3b30) circle, radius ≈ 8.5% of min dimension (min 64px), white outer halo +
 * white crosshair ticks, exported as JPEG quality 0.92.
 *
 * xRatio/yRatio are the click point as a fraction (0..1) of the image's displayed size.
 */
export function drawTapMarker(image: HTMLImageElement, xRatio: number, yRatio: number): string {
  const ctx = imageToCanvas(image);
  const { width, height } = ctx.canvas;

  const minDim = Math.min(width, height);
  const radius = Math.max(minDim * 0.085, 64);
  const cx = xRatio * width;
  const cy = yRatio * height;

  // White outer halo
  ctx.beginPath();
  ctx.arc(cx, cy, radius + radius * 0.35, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  ctx.fill();

  // Red marker circle
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = "#ff3b30";
  ctx.fill();

  // White crosshair ticks, extending outward from the circle's edge
  const tickLen = radius * 0.5;
  const tickWidth = Math.max(2, radius * 0.1);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = tickWidth;
  ctx.lineCap = "round";
  const dirs: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const [dx, dy] of dirs) {
    ctx.beginPath();
    ctx.moveTo(cx + dx * (radius - tickWidth), cy + dy * (radius - tickWidth));
    ctx.lineTo(cx + dx * (radius + tickLen), cy + dy * (radius + tickLen));
    ctx.stroke();
  }

  return ctx.canvas.toDataURL("image/jpeg", 0.92);
}
