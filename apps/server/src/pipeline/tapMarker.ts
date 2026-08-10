import sharp from "sharp";
import { parseDataUrl } from "../lib/dataUrl.js";

/**
 * Draws a bright ring at a normalized point on an image and returns the result as a JPEG data URL.
 *
 * Used to AIM a transition morph: the ring marks where the user tapped on the parent page, and the
 * marked copy is shown ONLY to the motion-prompt VLM (see backgroundClip.ts) so it can describe a
 * push toward that spot instead of the frame center. The mark is never sent to the video model and
 * never reaches the finished clip — it is an annotation for the prompt author, nothing more.
 *
 * A magenta ring with a white halo reads clearly on both light and dark art and is a colour that
 * effectively never appears in the felt/editorial illustration style, so the VLM does not mistake it
 * for part of the scene. Hollow on purpose: the tapped subject stays visible inside the ring.
 *
 * `x` / `y` are normalized 0..1 (x from the left, y from the top). Out-of-range values are clamped so
 * a bad coordinate still lands on the canvas rather than off it.
 */
export async function drawTapMarker(dataUrl: string, x: number, y: number): Promise<string> {
  const { base64 } = parseDataUrl(dataUrl);
  const image = sharp(Buffer.from(base64, "base64"));
  const { width, height } = await image.metadata();
  if (!width || !height) throw new Error("drawTapMarker: image has no dimensions");

  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const cx = Math.round(clamp(x) * width);
  const cy = Math.round(clamp(y) * height);
  const r = Math.round(0.05 * width); // ring radius ~5% of width — matches the spike-tested marker

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#FFFFFF" stroke-width="13" opacity="0.9"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#FF00E5" stroke-width="7"/>
    <circle cx="${cx}" cy="${cy}" r="5" fill="#FF00E5"/>
  </svg>`;

  const out = await image
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    // Flatten any transparency onto white BEFORE the JPEG encode. JPEG has no alpha channel, so a
    // transparent source would otherwise turn black — the VLM would then read a black background the
    // real (clean) frame never had. A no-op for the opaque JPEGs this normally runs on.
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 92 })
    .toBuffer();
  return `data:image/jpeg;base64,${out.toString("base64")}`;
}
