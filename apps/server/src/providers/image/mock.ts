import type { ImageGenInput, ImageGenResult, ImageProvider } from "../types.js";
import { solidColorPng, colorFromString } from "./png.js";

const DIMENSIONS: Record<ImageGenInput["aspectRatio"], [number, number]> = {
  "16:9": [960, 540],
  "3:4": [540, 720],
  "1:1": [640, 640],
};

/** Deterministic solid-color placeholder - no network calls. Used when FAL_KEY is absent. */
export class MockImageProvider implements ImageProvider {
  readonly modelId = "mock-image";
  readonly providerId = "mock";

  async generate(input: ImageGenInput): Promise<ImageGenResult> {
    const [width, height] = DIMENSIONS[input.aspectRatio];
    const rgb = colorFromString(input.prompt);
    const bytes = solidColorPng(width, height, rgb);
    return { bytes, contentType: "image/png" };
  }
}
