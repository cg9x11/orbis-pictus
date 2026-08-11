import type { ImageUsage } from "../types.js";

/** Published token rates in USD per 1,000,000 tokens (see the providers' official pricing pages). */
export interface ModelRate {
  /** Input (text/image) tokens $/1M. */
  inputPerM: number;
  /** Output (image) tokens $/1M. */
  outputPerM: number;
}

/**
 * Published per-model token rates for the token-billed image models we support, as of 2026-08.
 * Providers that bill per-image and return no token usage (fal, ark) are intentionally absent -
 * there's nothing to compute from. These feed only the optional DEBUG_IMAGE_PROMPT cost estimate;
 * the real charge always comes from the provider's own billing, so keep this current but don't
 * treat it as authoritative. OpenAI input uses the text-input rate (image-input, when a reference
 * is sent, is a bit higher, but input is a tiny fraction of the image-output cost either way).
 */
export const IMAGE_MODEL_RATES: Record<string, ModelRate> = {
  // Google Gemini (nano banana)
  "gemini-3.1-flash-lite-image": { inputPerM: 0.25, outputPerM: 30 },
  "gemini-3.1-flash-image": { inputPerM: 0.5, outputPerM: 60 },
  "gemini-3-pro-image": { inputPerM: 2, outputPerM: 120 },
  "gemini-2.5-flash-image": { inputPerM: 0.3, outputPerM: 30 },
  // OpenAI gpt-image
  "gpt-image-2": { inputPerM: 5, outputPerM: 30 },
  "gpt-image-1.5": { inputPerM: 5, outputPerM: 32 },
  "chatgpt-image-latest": { inputPerM: 5, outputPerM: 32 },
  "gpt-image-1-mini": { inputPerM: 2, outputPerM: 8 },
  "gpt-image-1": { inputPerM: 5, outputPerM: 40 },
};

export interface CostEstimate {
  usd: number;
  rate: ModelRate;
}

/** Estimates the USD cost of one generation from reported token usage and the model's published
 *  rates. Returns null when the model isn't in the table or no usage was reported - the caller then
 *  logs "n/a" rather than a misleading $0.0000. */
export function estimateImageCost(modelId: string, usage: ImageUsage | undefined): CostEstimate | null {
  const rate = IMAGE_MODEL_RATES[modelId];
  if (!rate || !usage) return null;
  const input = ((usage.inputTokens ?? 0) / 1_000_000) * rate.inputPerM;
  const output = ((usage.outputTokens ?? 0) / 1_000_000) * rate.outputPerM;
  return { usd: input + output, rate };
}
