import { z } from "zod";
import type { AspectRatio } from "@flipbook/shared";
import { QuotaExhaustedError, type ImageGenInput, type ImageGenResult, type ImageProvider } from "../types.js";
import { ArkRequestError, toArkRequestError } from "../ark/errors.js";
import { fetchWithRetry } from "../../lib/retry.js";
import { strConfig } from "../../config/index.js";
import type { ImageProviderFactory } from "./registry.js";

/**
 * Draft-tier (Phase 1 single-tier) sizes. BytePlus Ark rejects named sizes like "1K" for
 * seedream-4.x and enforces a minimum of 3,686,400 total pixels — well above the
 * original draft dimensions (1280x720 / 960x1280 / 960x960), so these are the same aspect
 * ratios scaled up to just clear that floor. Verified empirically 2026-08 against the live API.
 */
const DRAFT_SIZE_BY_ASPECT: Record<AspectRatio, string> = {
  "16:9": "2560x1440",
  "3:4": "1665x2220",
  "1:1": "1920x1920",
};

export class ArkImageProvider implements ImageProvider {
  readonly modelId: string;
  readonly providerId = "ark";
  private readonly fallbackModelId: string | undefined;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl: string, model: string, fallbackModel?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.modelId = model;
    this.fallbackModelId = fallbackModel;
  }

  async generate(input: ImageGenInput): Promise<ImageGenResult> {
    try {
      return await this.generateWithModel(this.modelId, input);
    } catch (err) {
      if (!(err instanceof ArkRequestError) || !err.isQuotaOrRateError) {
        throw err;
      }
      if (!this.fallbackModelId) {
        throw new QuotaExhaustedError(`Image quota exhausted: "${this.modelId}" was rejected (${err.code ?? err.message}).`);
      }
      try {
        return await this.generateWithModel(this.fallbackModelId, input);
      } catch (fallbackErr) {
        throw new QuotaExhaustedError(
          `Image quota exhausted: both "${this.modelId}" and fallback "${this.fallbackModelId}" ` +
            `were rejected (${err.code ?? err.message}; ${
              fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
            }).`,
        );
      }
    }
  }

  private async generateWithModel(model: string, input: ImageGenInput): Promise<ImageGenResult> {
    const body: Record<string, unknown> = {
      model,
      prompt: input.prompt,
      size: DRAFT_SIZE_BY_ASPECT[input.aspectRatio],
      response_format: "b64_json",
      watermark: false,
    };
    if (input.referenceImageDataUrl) {
      body.image = input.referenceImageDataUrl;
    }

    const res = await fetchWithRetry(`${this.baseUrl}/api/v3/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw await toArkRequestError(res, "Ark request failed");
    }

    const json = (await res.json()) as { data?: { b64_json?: string }[] };
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new Error(`Ark response missing image data: ${JSON.stringify(json)}`);

    // Verified empirically: Ark returns JPEG bytes even though the API is generic about format.
    return { bytes: Buffer.from(b64, "base64"), contentType: "image/jpeg" };
  }
}

const ArkImageConfigSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url(),
  model: z.string().min(1),
  fallbackModel: z.string().min(1).optional(),
});

export const arkImageFactory: ImageProviderFactory = {
  id: "ark",
  build: (ctx) => {
    const parsed = ArkImageConfigSchema.safeParse({
      apiKey: process.env.ARK_API_KEY,
      baseUrl: strConfig("ARK_BASE_URL", (c) => c.image?.ark?.baseUrl, "https://ark.ap-southeast.bytepluses.com"),
      model: strConfig("ARK_IMAGE_MODEL", (c) => c.image?.ark?.model, "seedream-4-5-251128"),
      fallbackModel: strConfig("ARK_IMAGE_MODEL_FALLBACK", (c) => c.image?.ark?.fallbackModel, "seedream-4-0-250828"),
    });
    if (!parsed.success) {
      ctx.reportMissing(`ARK_API_KEY/config (${parsed.error.issues.map((i) => i.path.join(".")).join(", ")})`);
      return null;
    }
    const { apiKey, baseUrl, model, fallbackModel } = parsed.data;
    return new ArkImageProvider(apiKey, baseUrl, model, fallbackModel);
  },
};
