import type { AspectRatio } from "@flipbook/shared";
import { QuotaExhaustedError, type ImageGenInput, type ImageGenResult, type ImageProvider } from "../types.js";
import { fetchWithRetry } from "../../lib/retry.js";
import { parseDataUrl } from "../../lib/dataUrl.js";
import { strConfig } from "../../config/index.js";
import type { ImageProviderFactory } from "./registry.js";

/** Gemini image models (nano banana family) accept these aspect-ratio strings directly. */
const ASPECT_RATIOS: Record<AspectRatio, string> = { "16:9": "16:9", "3:4": "3:4", "1:1": "1:1" };

interface GeminiInlineData {
  mimeType?: string;
  mime_type?: string;
  data?: string;
}
interface GeminiPart {
  inlineData?: GeminiInlineData;
  inline_data?: GeminiInlineData;
}
interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
}

/**
 * Google Gemini image generation (nano banana), via the generativelanguage REST `:generateContent`
 * endpoint. Supports a reference/input image (tap & edit modes) by adding it as an inline-data part.
 */
export class GeminiImageProvider implements ImageProvider {
  readonly providerId = "gemini";
  readonly modelId: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly imageSize: string;

  constructor(apiKey: string, baseUrl: string, model: string, imageSize: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.modelId = model;
    this.imageSize = imageSize;
  }

  async generate(input: ImageGenInput): Promise<ImageGenResult> {
    const parts: unknown[] = [{ text: input.prompt }];
    if (input.referenceImageDataUrl) {
      const { mimeType, base64 } = parseDataUrl(input.referenceImageDataUrl);
      parts.push({ inlineData: { mimeType, data: base64 } });
    }

    const res = await fetchWithRetry(`${this.baseUrl}/models/${this.modelId}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": this.apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: { aspectRatio: ASPECT_RATIOS[input.aspectRatio], imageSize: this.imageSize },
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 429) {
        throw new QuotaExhaustedError(`Image quota exhausted: Gemini "${this.modelId}" was rate-limited (429). ${body}`);
      }
      throw new Error(`Gemini image request failed (${res.status}): ${body}`);
    }

    const json = (await res.json()) as GeminiResponse;
    const inline = json.candidates
      ?.flatMap((c) => c.content?.parts ?? [])
      .map((p) => p.inlineData ?? p.inline_data)
      .find((d): d is GeminiInlineData => Boolean(d?.data));
    if (!inline?.data) {
      throw new Error(`Gemini response missing image data: ${JSON.stringify(json).slice(0, 500)}`);
    }
    return { bytes: Buffer.from(inline.data, "base64"), contentType: inline.mimeType ?? inline.mime_type ?? "image/png" };
  }
}

export const geminiImageFactory: ImageProviderFactory = {
  id: "gemini",
  build: (ctx) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      ctx.reportMissing("GEMINI_API_KEY (for image.provider=gemini)");
      return null;
    }
    const model = strConfig("GEMINI_IMAGE_MODEL", (c) => c.image?.gemini?.model, "gemini-3.1-flash-lite-image");
    const baseUrl = strConfig("GEMINI_IMAGE_BASE_URL", (c) => c.image?.gemini?.baseUrl, "https://generativelanguage.googleapis.com/v1beta");
    const imageSize = strConfig("GEMINI_IMAGE_SIZE", (c) => c.image?.gemini?.imageSize, "1K");
    return new GeminiImageProvider(apiKey, baseUrl, model, imageSize);
  },
};
