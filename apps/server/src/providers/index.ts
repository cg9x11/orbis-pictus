import { z } from "zod";
import { MockLlmProvider } from "./llm/mock.js";
import { GeminiLlmProvider } from "./llm/gemini.js";
import { AnthropicLlmProvider } from "./llm/anthropic.js";
import { MockImageProvider } from "./image/mock.js";
import { FalImageProvider } from "./image/fal.js";
import { ArkImageProvider } from "./image/ark.js";
import { MockVideoProvider } from "./video/mock.js";
import { ArkVideoProvider } from "./video/ark.js";
import { NoneSearchProvider } from "./search/none.js";
import { LlmSearchProvider } from "./search/llm.js";
import { CachingSearchProvider } from "./search/caching.js";
import { boolEnvFlag, positiveIntEnv } from "../lib/env.js";
import type { ImageProvider, LlmProvider, SearchProvider, VideoProvider } from "./types.js";

const ArkConfigSchema = z.object({
  ARK_API_KEY: z.string().min(1),
  ARK_BASE_URL: z.string().url(),
  ARK_IMAGE_MODEL: z.string().min(1),
  ARK_IMAGE_MODEL_FALLBACK: z.string().min(1).optional(),
});

const ArkVideoConfigSchema = z.object({
  ARK_API_KEY: z.string().min(1),
  ARK_BASE_URL: z.string().url(),
  ARK_VIDEO_MODEL: z.string().min(1),
});

export interface Providers {
  llm: LlmProvider;
  image: ImageProvider;
  video: VideoProvider;
  search: SearchProvider;
}

/** Looks up `name` in `builders` and runs it, or runs `fallback` if `name` isn't registered —
 *  adding a provider is a new registry entry here, not a new branch in an if/else chain. Each
 *  builder is responsible for validating its own config and pushing to `missingKeys` (falling
 *  back to a mock/none provider itself) when that config is missing/invalid; `fallback` only
 *  covers an unrecognized provider *name* (including the implicit default when none is set). */
function selectProvider<T>(name: string, builders: Record<string, () => T>, fallback: () => T): T {
  const build = builders[name];
  return build ? build() : fallback();
}

function pushMissingConfig(missingKeys: string[], label: string, issues: z.ZodIssue[]): void {
  missingKeys.push(`${label} (${issues.map((i) => i.path.join(".")).join(", ")})`);
}

function buildAnthropicLlm(missingKeys: string[]): LlmProvider {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    missingKeys.push("LLM_API_KEY");
    return new MockLlmProvider();
  }
  const baseURL = process.env.LLM_BASE_URL || "http://localhost:20128";
  const promptAuthorModel = process.env.PROMPT_AUTHOR_MODEL || "cc/claude-sonnet-5";
  const tapVlmModel = process.env.TAP_VLM_MODEL || "cc/claude-haiku-4-5";
  return new AnthropicLlmProvider(apiKey, baseURL, promptAuthorModel, tapVlmModel);
}

function buildGeminiLlm(missingKeys: string[]): LlmProvider {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    missingKeys.push("GEMINI_API_KEY");
    return new MockLlmProvider();
  }
  return new GeminiLlmProvider(apiKey);
}

function buildLlmProvider(missingKeys: string[]): LlmProvider {
  const defaultProvider = process.env.LLM_API_KEY ? "anthropic" : "gemini";
  return selectProvider(
    process.env.LLM_PROVIDER ?? defaultProvider,
    {
      mock: () => new MockLlmProvider(),
      anthropic: () => buildAnthropicLlm(missingKeys),
      gemini: () => buildGeminiLlm(missingKeys),
    },
    () => new MockLlmProvider(),
  );
}

function buildArkImage(missingKeys: string[]): ImageProvider {
  const parsed = ArkConfigSchema.safeParse({
    ARK_API_KEY: process.env.ARK_API_KEY,
    ARK_BASE_URL: process.env.ARK_BASE_URL || "https://ark.ap-southeast.bytepluses.com",
    ARK_IMAGE_MODEL: process.env.ARK_IMAGE_MODEL || "seedream-4-5-251128",
    ARK_IMAGE_MODEL_FALLBACK: process.env.ARK_IMAGE_MODEL_FALLBACK || "seedream-4-0-250828",
  });
  if (!parsed.success) {
    pushMissingConfig(missingKeys, "ARK_API_KEY/config", parsed.error.issues);
    return new MockImageProvider();
  }
  const { ARK_API_KEY, ARK_BASE_URL, ARK_IMAGE_MODEL, ARK_IMAGE_MODEL_FALLBACK } = parsed.data;
  return new ArkImageProvider(ARK_API_KEY, ARK_BASE_URL, ARK_IMAGE_MODEL, ARK_IMAGE_MODEL_FALLBACK);
}

function buildFalImage(missingKeys: string[]): ImageProvider {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) {
    missingKeys.push("FAL_KEY");
    return new MockImageProvider();
  }
  return new FalImageProvider(apiKey, process.env.IMAGE_MODEL || "fal-ai/flux/schnell");
}

function buildImageProvider(missingKeys: string[]): ImageProvider {
  return selectProvider(
    process.env.IMAGE_PROVIDER ?? "fal",
    {
      mock: () => new MockImageProvider(),
      ark: () => buildArkImage(missingKeys),
      fal: () => buildFalImage(missingKeys),
    },
    () => new MockImageProvider(),
  );
}

function buildArkVideo(missingKeys: string[]): VideoProvider {
  const parsed = ArkVideoConfigSchema.safeParse({
    ARK_API_KEY: process.env.ARK_API_KEY,
    ARK_BASE_URL: process.env.ARK_BASE_URL || "https://ark.ap-southeast.bytepluses.com",
    ARK_VIDEO_MODEL: process.env.ARK_VIDEO_MODEL || "seedance-1-0-pro-250528",
  });
  if (!parsed.success) {
    pushMissingConfig(missingKeys, "ARK_API_KEY/config for video", parsed.error.issues);
    return new MockVideoProvider();
  }
  const { ARK_API_KEY, ARK_BASE_URL, ARK_VIDEO_MODEL } = parsed.data;
  return new ArkVideoProvider(ARK_API_KEY, ARK_BASE_URL, ARK_VIDEO_MODEL);
}

function buildVideoProvider(missingKeys: string[]): VideoProvider {
  // Defaults to "mock" even when ARK_API_KEY is already set (unlike LLM/image), because video is
  // an opt-in experimental feature gated separately by VIDEO_ENABLED (PLAN §3 Phase 5) — a user
  // shouldn't start burning real video quota just because they already configured Ark for images.
  return selectProvider(
    process.env.VIDEO_PROVIDER ?? "mock",
    { ark: () => buildArkVideo(missingKeys) },
    () => new MockVideoProvider(),
  );
}

function buildLlmSearch(missingKeys: string[]): SearchProvider {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    missingKeys.push("LLM_API_KEY (for SEARCH_PROVIDER=llm)");
    return new NoneSearchProvider();
  }
  const baseURL = process.env.LLM_BASE_URL || "http://localhost:20128";
  const searchModel = process.env.SEARCH_MODEL || "cc/claude-sonnet-5";
  const timeoutMs = positiveIntEnv("SEARCH_TIMEOUT_MS", 45000);
  return new LlmSearchProvider(apiKey, baseURL, searchModel, timeoutMs);
}

function buildSearchProvider(missingKeys: string[]): SearchProvider {
  const defaultProvider = process.env.LLM_API_KEY ? "llm" : "none";
  const provider = selectProvider(
    process.env.SEARCH_PROVIDER ?? defaultProvider,
    {
      llm: () => buildLlmSearch(missingKeys),
      none: () => new NoneSearchProvider(),
    },
    () => new NoneSearchProvider(),
  );
  // Opt-in in-memory reuse of search summaries across repeated queries (SEARCH_CACHE_ENABLED),
  // wrapping whichever provider was selected — harmless around the `none` stub.
  return boolEnvFlag("SEARCH_CACHE_ENABLED") ? new CachingSearchProvider(provider) : provider;
}

export function createProviders(): { providers: Providers; missingKeys: string[] } {
  const missingKeys: string[] = [];
  const providers: Providers = {
    llm: buildLlmProvider(missingKeys),
    image: buildImageProvider(missingKeys),
    video: buildVideoProvider(missingKeys),
    search: buildSearchProvider(missingKeys),
  };
  return { providers, missingKeys };
}
