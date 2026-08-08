import type { AspectRatio } from "@flipbook/shared";
import { QuotaExhaustedError, UnknownModelError, type ImageGenInput, type ImageGenResult, type ImageProvider } from "../types.js";
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
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
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
      // The model id is part of the request path, so a 404 from this endpoint is about the model.
      // Verified empirically 2026-08-08: an unknown model answers 404 with
      // `{"error":{"code":404,"message":"models/<id> is not found for API version v1beta, or is not
      // supported for generateContent…","status":"NOT_FOUND"}}`. Note this also covers a real model
      // that simply cannot do generateContent — the remedy is the same either way.
      if (res.status === 404) {
        throw new UnknownModelError(`Gemini does not recognise image model "${this.modelId}". ${body}`);
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
    const u = json.usageMetadata;
    return {
      bytes: Buffer.from(inline.data, "base64"),
      contentType: inline.mimeType ?? inline.mime_type ?? "image/png",
      usage: u
        ? { inputTokens: u.promptTokenCount, outputTokens: u.candidatesTokenCount, totalTokens: u.totalTokenCount }
        : undefined,
    };
  }
}

/** Sizes Gemini accepts. Exported so the settings catalog can build its dropdown from this one
 *  list rather than repeating it — note not every model supports every size (the Lite model is 1K
 *  only), which the API enforces and this list deliberately does not. */
export const GEMINI_IMAGE_SIZES = ["512", "1K", "2K", "4K"] as const;

/**
 * An unrecognised *override* falls through to the configured value instead of reaching the API,
 * which rejects an unknown imageSize outright. Only the override is checked: the configured value
 * stays unvalidated exactly as it always has been, because changing how a bad `config.yml` behaves
 * is a separate decision from adding a picker.
 */
function validImageSize(raw: string | undefined): string | undefined {
  return raw !== undefined && (GEMINI_IMAGE_SIZES as readonly string[]).includes(raw) ? raw : undefined;
}

export const geminiImageFactory: ImageProviderFactory = {
  id: "gemini",
  build: (ctx) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      ctx.reportMissing("GEMINI_API_KEY (for image.provider=gemini)");
      return null;
    }
    const model = ctx.overrides.imageModel ?? strConfig("GEMINI_IMAGE_MODEL", (c) => c.image?.gemini?.model, "gemini-3.1-flash-lite-image");
    const baseUrl = strConfig("GEMINI_IMAGE_BASE_URL", (c) => c.image?.gemini?.baseUrl, "https://generativelanguage.googleapis.com/v1beta");
    const imageSize =
      validImageSize(ctx.overrides.geminiImageSize) ?? strConfig("GEMINI_IMAGE_SIZE", (c) => c.image?.gemini?.imageSize, "1K");
    return new GeminiImageProvider(apiKey, baseUrl, model, imageSize);
  },
};
