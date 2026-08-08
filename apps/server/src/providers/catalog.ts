import type { ModelSettings, ProviderOption } from "@flipbook/shared";
import { strConfig } from "../config/index.js";
import {
  MAX_OVERRIDE_DURATION_SECONDS,
  RESOLUTIONS,
  getVideoDurationSeconds,
  getVideoResolution,
} from "../pipeline/videoConfig.js";
import { GEMINI_IMAGE_SIZES } from "./image/gemini.js";
import { OPENAI_IMAGE_QUALITIES } from "./image/openai.js";
import { resolveProviders } from "./index.js";

/**
 * What the settings panel offers, and what the server is actually using.
 *
 * The model lists here are a convenience, not a rule: nothing validates a model id against them,
 * because the panel also takes free text and provider model ids change faster than this file can.
 * They exist so the common case is one click. Keep them in step with the suggestions in
 * config.example.yml.
 *
 * Distinct from IMAGE_MODEL_RATES in ./image/pricing.ts, which answers a different question — "do
 * we know this model's token price" — and so both omits the per-image-billed providers (ark, fal)
 * and keeps older ids around for costing past generations.
 */
interface ProviderEntry {
  name: string;
  label: string;
  /** Env var holding this provider's secret, or null when it needs none (the mock). */
  keyEnv: string | null;
  models: string[];
}

const IMAGE_PROVIDERS: readonly ProviderEntry[] = [
  {
    name: "ark",
    label: "BytePlus Ark (Seedream)",
    keyEnv: "ARK_API_KEY",
    models: ["seedream-4-5-251128", "seedream-4-0-250828"],
  },
  { name: "fal", label: "fal.ai", keyEnv: "FAL_KEY", models: ["fal-ai/flux/schnell", "fal-ai/nano-banana"] },
  {
    name: "gemini",
    label: "Google Gemini",
    keyEnv: "GEMINI_API_KEY",
    models: ["gemini-3.1-flash-lite-image", "gemini-3.1-flash-image", "gemini-3-pro-image"],
  },
  {
    name: "openai",
    label: "OpenAI",
    keyEnv: "OPENAI_API_KEY",
    models: ["gpt-image-1.5", "gpt-image-2", "gpt-image-1-mini", "gpt-image-1"],
  },
  { name: "mock", label: "Mock (draws placeholders, spends nothing)", keyEnv: null, models: [] },
];

const VIDEO_PROVIDERS: readonly ProviderEntry[] = [
  {
    name: "ark",
    label: "BytePlus Ark (Seedance)",
    keyEnv: "ARK_API_KEY",
    models: ["seedance-1-0-pro-fast-251015", "seedance-1-0-pro-250528"],
  },
  { name: "mock", label: "Mock (spends nothing)", keyEnv: null, models: [] },
];

/** Present AND non-blank. `.env` files routinely carry a declared-but-empty key (a placeholder left
 *  after copying .env.example), and the provider factories treat that as missing too. */
function hasKey(keyEnv: string | null): boolean {
  if (keyEnv === null) return true;
  return Boolean(process.env[keyEnv]?.trim());
}

/**
 * Builds the option list, making sure the model in use is always among the choices for the provider
 * in use. Without this, a `config.yml` naming a model this file has not heard of would leave the
 * dropdown with no matching entry, and the panel would look like it had selected nothing.
 */
function toOptions(entries: readonly ProviderEntry[], activeProvider: string, activeModel: string): ProviderOption[] {
  return entries.map((entry) => {
    const models = [...entry.models];
    if (entry.name === activeProvider && activeModel && !models.includes(activeModel)) {
      models.unshift(activeModel);
    }
    return { name: entry.name, label: entry.label, available: hasKey(entry.keyEnv), models };
  });
}

/**
 * Read fresh on every request so an edit to `config.yml` shows up in the panel without a restart —
 * the config layer already re-reads the file when its mtime changes.
 */
export function buildModelSettings(): ModelSettings {
  const { providers } = resolveProviders();
  const image = providers.image;
  const video = providers.video;

  return {
    image: {
      providers: toOptions(IMAGE_PROVIDERS, image.providerId, image.modelId),
      provider: image.providerId,
      model: image.modelId,
    },
    video: {
      providers: toOptions(VIDEO_PROVIDERS, video.providerId, video.modelId),
      provider: video.providerId,
      model: video.modelId,
      resolutions: [...RESOLUTIONS],
      resolution: getVideoResolution(),
      durationSeconds: getVideoDurationSeconds(),
      maxDurationSeconds: MAX_OVERRIDE_DURATION_SECONDS,
    },
    extras: {
      geminiImageSizes: [...GEMINI_IMAGE_SIZES],
      geminiImageSize: strConfig("GEMINI_IMAGE_SIZE", (c) => c.image?.gemini?.imageSize, "1K"),
      openaiImageQualities: [...OPENAI_IMAGE_QUALITIES],
      openaiImageQuality: strConfig("OPENAI_IMAGE_QUALITY", (c) => c.image?.openai?.quality, "medium"),
      arkFallbackModel: strConfig("ARK_IMAGE_MODEL_FALLBACK", (c) => c.image?.ark?.fallbackModel, "seedream-4-0-250828"),
    },
  };
}
