import type { AspectRatio } from "@orbis/shared";
import { QuotaExhaustedError, UnknownModelError, type ImageGenInput, type ImageGenResult, type ImageProvider } from "../types.js";
import { fetchWithRetry } from "../../lib/retry.js";
import { strConfig } from "../../config/index.js";
import type { ImageProviderFactory } from "./registry.js";

/** gpt-image supports these discrete sizes (1024², portrait, landscape) across all family members. */
const SIZE_BY_ASPECT: Record<AspectRatio, string> = {
  "16:9": "1536x1024",
  "3:4": "1024x1536",
  "1:1": "1024x1024",
};

/**
 * OpenAI image generation (gpt-image-1.5 / gpt-image-2 / mini) via POST /v1/images/generations.
 * gpt-image always returns base64 in `data[].b64_json`. Reference/edit input is intentionally NOT
 * used here - gpt-image support on the /images/edits endpoint is inconsistent, so `referenceImageDataUrl`
 * is ignored (edit mode still re-renders from the authored prompt; it just loses pixel continuity).
 */
export class OpenAiImageProvider implements ImageProvider {
  readonly providerId = "openai";
  readonly modelId: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly quality: string;

  constructor(apiKey: string, baseUrl: string, model: string, quality: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.modelId = model;
    this.quality = quality;
  }

  async generate(input: ImageGenInput): Promise<ImageGenResult> {
    const res = await fetchWithRetry(`${this.baseUrl}/images/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: this.modelId,
        prompt: input.prompt,
        size: SIZE_BY_ASPECT[input.aspectRatio],
        quality: this.quality,
        n: 1,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 429) {
        throw new QuotaExhaustedError(`Image quota exhausted: OpenAI "${this.modelId}" was rate-limited (429). ${body}`);
      }
      // NOT verified live - unlike the ark, gemini and fal branches, this one is written from
      // OpenAI's published error contract, because OPENAI_API_KEY is empty in this deployment and
      // the request could not be made. Re-check it against a real 404 before relying on it.
      //
      // Narrower than the gemini/fal checks on purpose: those two carry the model id in the URL, so
      // any 404 is about the model. OpenAI sends the model in the BODY, so a bare 404 more likely
      // means a wrong base URL - which a different model would not fix. Hence the extra keyword.
      if (res.status === 404 && /model/i.test(body)) {
        throw new UnknownModelError(`OpenAI does not recognise image model "${this.modelId}". ${body}`);
      }
      throw new Error(`OpenAI image request failed (${res.status}): ${body}`);
    }

    const json = (await res.json()) as {
      data?: { b64_json?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
    };
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new Error(`OpenAI response missing image data: ${JSON.stringify(json).slice(0, 500)}`);
    const u = json.usage;
    // gpt-image returns PNG by default; the storage layer re-encodes to JPEG on downscale anyway.
    return {
      bytes: Buffer.from(b64, "base64"),
      contentType: "image/png",
      usage: u ? { inputTokens: u.input_tokens, outputTokens: u.output_tokens, totalTokens: u.total_tokens } : undefined,
    };
  }
}

/** Qualities the gpt-image family accepts. Exported so the settings catalog builds its dropdown
 *  from this one list rather than repeating it. */
export const OPENAI_IMAGE_QUALITIES = ["low", "medium", "high"] as const;

/** An unrecognised *override* falls through to the configured value rather than reaching the API.
 *  Only the override is checked - see the matching note in ./gemini.ts for why the configured value
 *  is deliberately left as-is. */
function validQuality(raw: string | undefined): string | undefined {
  return raw !== undefined && (OPENAI_IMAGE_QUALITIES as readonly string[]).includes(raw) ? raw : undefined;
}

export const openaiImageFactory: ImageProviderFactory = {
  id: "openai",
  build: (ctx) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      ctx.reportMissing("OPENAI_API_KEY (for image.provider=openai)");
      return null;
    }
    const model = ctx.overrides.imageModel ?? strConfig("OPENAI_IMAGE_MODEL", (c) => c.image?.openai?.model, "gpt-image-1.5");
    const baseUrl = strConfig("OPENAI_IMAGE_BASE_URL", (c) => c.image?.openai?.baseUrl, "https://api.openai.com/v1");
    const quality =
      validQuality(ctx.overrides.openaiImageQuality) ?? strConfig("OPENAI_IMAGE_QUALITY", (c) => c.image?.openai?.quality, "medium");
    return new OpenAiImageProvider(apiKey, baseUrl, model, quality);
  },
};
