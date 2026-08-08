import { z } from "zod";
import type { AspectRatio } from "@flipbook/shared";
import { QuotaExhaustedError, UnknownModelError, type ImageGenInput, type ImageGenResult, type ImageProvider } from "../types.js";
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
      // Checked before the quota branch: an unrecognised model id is not a budget problem, so the
      // configured fallback model (which exists for quota) is the wrong remedy. Retrying a bad name
      // on a second model belongs to modelFallback.ts, which knows the server's configured default.
      if (err instanceof ArkRequestError && err.isUnknownModelError) {
        throw new UnknownModelError(`Ark does not recognise image model "${this.modelId}" (${err.code ?? err.message}).`);
      }
      if (!(err instanceof ArkRequestError) || !err.isQuotaOrRateError) {
        throw err;
      }
      if (!this.fallbackModelId) {
        throw new QuotaExhaustedError(`Image quota exhausted: "${this.modelId}" was rejected (${err.code ?? err.message}).`);
      }
      try {
        // usedModelId, so the node records the model that actually drew rather than the one that
        // was rejected — the prompt hash and node row are both built from `modelId` before this
        // point, so without it every quota fallback silently credits the wrong model.
        const result = await this.generateWithModel(this.fallbackModelId, input);
        return { ...result, usedModelId: this.fallbackModelId };
      } catch (fallbackErr) {
        // Same reasoning as the primary-model check above, applied to the fallback. The fallback id
        // is user-settable from the settings panel's free-text field, so it can be a name Ark has
        // never heard of — and calling that "quota exhausted" is both untrue and harmful:
        // modelFallback.ts routes on the error CLASS alone and catches only UnknownModelError, so a
        // QuotaExhaustedError here would fail the page outright while blaming the user's budget.
        if (fallbackErr instanceof ArkRequestError && fallbackErr.isUnknownModelError) {
          throw new UnknownModelError(
            `Ark does not recognise fallback image model "${this.fallbackModelId}" ` +
              `(${fallbackErr.code ?? fallbackErr.message}).`,
          );
        }
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
      model: ctx.overrides.imageModel ?? strConfig("ARK_IMAGE_MODEL", (c) => c.image?.ark?.model, "seedream-4-5-251128"),
      fallbackModel:
        ctx.overrides.arkFallbackModel ??
        strConfig("ARK_IMAGE_MODEL_FALLBACK", (c) => c.image?.ark?.fallbackModel, "seedream-4-0-250828"),
    });
    if (!parsed.success) {
      ctx.reportMissing(`ARK_API_KEY/config (${parsed.error.issues.map((i) => i.path.join(".")).join(", ")})`);
      return null;
    }
    const { apiKey, baseUrl, model, fallbackModel } = parsed.data;
    return new ArkImageProvider(apiKey, baseUrl, model, fallbackModel);
  },
};
