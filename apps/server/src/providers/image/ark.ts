import type { AspectRatio } from "@flipbook/shared";
import type { ImageGenInput, ImageGenResult, ImageProvider } from "../types.js";

/**
 * Draft-tier (Phase 1 single-tier) sizes. BytePlus Ark rejects named sizes like "1K" for
 * seedream-4.x and enforces a minimum of 3,686,400 total pixels — well above PLAN §1.3's
 * original draft dimensions (1280x720 / 960x1280 / 960x960), so these are the same aspect
 * ratios scaled up to just clear that floor. Verified empirically 2026-08 against the live API.
 */
const DRAFT_SIZE_BY_ASPECT: Record<AspectRatio, string> = {
  "16:9": "2560x1440",
  "3:4": "1665x2220",
  "1:1": "1920x1920",
};

// Phase 3: final tier (larger size, same aspect ratios). PLAN §1.3's original final dimensions
// (1920x1088 / 1088x1920 / 1088x1088) are themselves below Ark's minimum, so re-derive at that
// time rather than reusing them verbatim.
// const FINAL_SIZE_BY_ASPECT: Record<AspectRatio, string> = {
//   "16:9": "3840x2160",
//   "3:4": "2500x3332",
//   "1:1": "2880x2880",
// };

const QUOTA_ERROR_PATTERN = /quota|rate.?limit|too many requests|exceeded|insufficient|overdue|throttl/i;

interface ArkErrorBody {
  error?: { code?: string; message?: string; type?: string };
}

class ArkRequestError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, code: string | undefined, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }

  get isQuotaOrRateError(): boolean {
    if (this.status === 429) return true;
    return QUOTA_ERROR_PATTERN.test(`${this.code ?? ""} ${this.message}`);
  }
}

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
      if (!(err instanceof ArkRequestError) || !err.isQuotaOrRateError || !this.fallbackModelId) {
        throw err;
      }
      try {
        return await this.generateWithModel(this.fallbackModelId, input);
      } catch (fallbackErr) {
        throw new Error(
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

    const res = await fetch(`${this.baseUrl}/api/v3/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      let parsed: ArkErrorBody | null = null;
      try {
        parsed = JSON.parse(text) as ArkErrorBody;
      } catch {
        // non-JSON error body, fall through with raw text
      }
      throw new ArkRequestError(
        res.status,
        parsed?.error?.code,
        parsed?.error?.message ?? `Ark request failed (${res.status}): ${text}`,
      );
    }

    const json = (await res.json()) as { data?: { b64_json?: string }[] };
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new Error(`Ark response missing image data: ${JSON.stringify(json)}`);

    // Verified empirically: Ark returns JPEG bytes even though the API is generic about format.
    return { bytes: Buffer.from(b64, "base64"), contentType: "image/jpeg" };
  }
}
