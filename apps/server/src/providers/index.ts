import { z } from "zod";
import { MockLlmProvider } from "./llm/mock.js";
import { GeminiLlmProvider } from "./llm/gemini.js";
import { AnthropicLlmProvider } from "./llm/anthropic.js";
import { buildImageProvider } from "./image/index.js";
import { MockVideoProvider } from "./video/mock.js";
import { ArkVideoProvider } from "./video/ark.js";
import { NoneSearchProvider } from "./search/none.js";
import { LlmSearchProvider } from "./search/llm.js";
import { CachingSearchProvider } from "./search/caching.js";
import { boolConfig, intConfig, strConfig } from "../config/index.js";
import type { ImageProvider, LlmProvider, SearchProvider, VideoProvider } from "./types.js";

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
  const baseURL = strConfig("LLM_BASE_URL", (c) => c.llm?.baseUrl, "http://localhost:20128");
  const promptAuthorModel = strConfig("PROMPT_AUTHOR_MODEL", (c) => c.llm?.promptAuthorModel, "cc/claude-sonnet-5");
  const tapVlmModel = strConfig("TAP_VLM_MODEL", (c) => c.llm?.tapVlmModel, "cc/claude-haiku-4-5");
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
    strConfig("LLM_PROVIDER", (c) => c.llm?.provider, defaultProvider),
    {
      mock: () => new MockLlmProvider(),
      anthropic: () => buildAnthropicLlm(missingKeys),
      gemini: () => buildGeminiLlm(missingKeys),
    },
    () => new MockLlmProvider(),
  );
}

// Image providers live in their own self-describing registry (./image/index.ts): add a provider by
// dropping an ImageProviderFactory into that array, no change here. buildImageProvider is re-exported
// below alongside the other build*Provider functions.

function buildArkVideo(missingKeys: string[]): VideoProvider {
  const parsed = ArkVideoConfigSchema.safeParse({
    ARK_API_KEY: process.env.ARK_API_KEY,
    ARK_BASE_URL: strConfig("ARK_BASE_URL", (c) => c.image?.ark?.baseUrl, "https://ark.ap-southeast.bytepluses.com"),
    ARK_VIDEO_MODEL: strConfig("ARK_VIDEO_MODEL", (c) => c.video?.model, "seedance-1-0-pro-250528"),
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
    strConfig("VIDEO_PROVIDER", (c) => c.video?.provider, "mock"),
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
  const baseURL = strConfig("LLM_BASE_URL", (c) => c.llm?.baseUrl, "http://localhost:20128");
  const searchModel = strConfig("SEARCH_MODEL", (c) => c.search?.model, "cc/claude-sonnet-5");
  const timeoutMs = intConfig("SEARCH_TIMEOUT_MS", (c) => c.search?.timeoutMs, 45000);
  return new LlmSearchProvider(apiKey, baseURL, searchModel, timeoutMs);
}

function buildSearchProvider(missingKeys: string[]): SearchProvider {
  const defaultProvider = process.env.LLM_API_KEY ? "llm" : "none";
  const provider = selectProvider(
    strConfig("SEARCH_PROVIDER", (c) => c.search?.provider, defaultProvider),
    {
      llm: () => buildLlmSearch(missingKeys),
      none: () => new NoneSearchProvider(),
    },
    () => new NoneSearchProvider(),
  );
  // Opt-in in-memory reuse of search summaries across repeated queries (SEARCH_CACHE_ENABLED /
  // search.cacheEnabled), wrapping whichever provider was selected — harmless around the `none` stub.
  return boolConfig("SEARCH_CACHE_ENABLED", (c) => c.search?.cacheEnabled, false) ? new CachingSearchProvider(provider) : provider;
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
