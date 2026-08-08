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
import type { ModelOverrides } from "@orbis/shared";
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

/**
 * UI-selected provider/model choices for a single request, in the server's camelCase vocabulary.
 * An absent (or blank) field means "use the configured default", so an empty object reproduces
 * exactly the behaviour of reading `config.yml`/env alone.
 *
 * Only image and video are overridable: they are the two the picker exposes, and both are thin
 * `fetch` wrappers that cost nothing to rebuild. LLM and search are deliberately absent — see
 * `baseProviders` below for why.
 */
export interface ProviderOverrides {
  imageProvider?: string;
  imageModel?: string;
  videoProvider?: string;
  videoModel?: string;
  geminiImageSize?: string;
  openaiImageQuality?: string;
  arkFallbackModel?: string;
}

/** What the route factories receive in place of a frozen `Providers`: resolution deferred to
 *  request time, so a model switched in the UI applies to the very next request with no restart. */
export type ProviderResolver = (overrides?: ProviderOverrides) => Providers;

/**
 * Maps the snake_case override fields carried on a generate request onto `ProviderOverrides`.
 * Lives next to the type so that adding an override key touches one place, and accepts the
 * structural `ModelOverrides` shape so any request schema merging it can be passed straight in.
 */
export function toProviderOverrides(req: ModelOverrides): ProviderOverrides {
  return {
    imageProvider: req.image_provider,
    imageModel: req.image_model,
    videoProvider: req.video_provider,
    videoModel: req.video_model,
    geminiImageSize: req.gemini_image_size,
    openaiImageQuality: req.openai_image_quality,
    arkFallbackModel: req.ark_fallback_model,
  };
}

/**
 * Drops blank/whitespace values so that a key which is present always holds a real one.
 *
 * Done once, here at the entry point, so nothing downstream has to repeat the check: the video
 * factories below and every image factory in ./image/* can simply write
 * `overrides.x ?? strConfig(...)`. Mirrors how `strConfig` already treats an empty env var —
 * blank means "unset", never "blank out the configured default".
 */
function normalizeOverrides(raw: ProviderOverrides): ProviderOverrides {
  const clean: ProviderOverrides = {};
  for (const key of Object.keys(raw) as (keyof ProviderOverrides)[]) {
    const trimmed = raw[key]?.trim();
    if (trimmed) clean[key] = trimmed;
  }
  return clean;
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

function buildArkVideo(missingKeys: string[], overrides: ProviderOverrides): VideoProvider {
  const parsed = ArkVideoConfigSchema.safeParse({
    ARK_API_KEY: process.env.ARK_API_KEY,
    ARK_BASE_URL: strConfig("ARK_BASE_URL", (c) => c.image?.ark?.baseUrl, "https://ark.ap-southeast.bytepluses.com"),
    ARK_VIDEO_MODEL: overrides.videoModel ?? strConfig("ARK_VIDEO_MODEL", (c) => c.video?.model, "seedance-1-0-pro-250528"),
  });
  if (!parsed.success) {
    pushMissingConfig(missingKeys, "ARK_API_KEY/config for video", parsed.error.issues);
    return new MockVideoProvider();
  }
  const { ARK_API_KEY, ARK_BASE_URL, ARK_VIDEO_MODEL } = parsed.data;
  return new ArkVideoProvider(ARK_API_KEY, ARK_BASE_URL, ARK_VIDEO_MODEL);
}

function buildVideoProvider(missingKeys: string[], overrides: ProviderOverrides): VideoProvider {
  // Defaults to "mock" even when ARK_API_KEY is already set (unlike LLM/image), because video is
  // an opt-in experimental feature gated separately by VIDEO_ENABLED — a user
  // shouldn't start burning real video quota just because they already configured Ark for images.
  return selectProvider(
    overrides.videoProvider ?? strConfig("VIDEO_PROVIDER", (c) => c.video?.provider, "mock"),
    { ark: () => buildArkVideo(missingKeys, overrides) },
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

interface BaseProviders {
  llm: LlmProvider;
  search: SearchProvider;
  missingKeys: string[];
}

// Built once per process rather than per request. Neither is UI-selectable, both construct heavier
// clients than the image/video wrappers, and CachingSearchProvider holds an in-memory summary cache
// that only pays off if the instance outlives a single request — rebuilding it per request would
// silently disable the very cache it exists to provide.
let base: BaseProviders | undefined;

function baseProviders(): BaseProviders {
  if (!base) {
    const missingKeys: string[] = [];
    base = { llm: buildLlmProvider(missingKeys), search: buildSearchProvider(missingKeys), missingKeys };
  }
  return base;
}

/**
 * Builds the provider set for one request.
 *
 * Image and video are constructed fresh on every call, so a provider/model chosen in the UI — or
 * edited in `config.yml`, which `fileConfig` already re-reads on mtime change — takes effect on the
 * next request with no restart. Both are thin `fetch` wrappers holding an API key and a couple of
 * strings, so building them per request is cheap. LLM and search come from the memoized base above.
 *
 * Called with no argument for the server's configured defaults, which is what boot does to produce
 * the startup missing-key warning.
 */
export function resolveProviders(raw: ProviderOverrides = {}): { providers: Providers; missingKeys: string[] } {
  const { llm, search, missingKeys: baseMissing } = baseProviders();
  // Copied, not aliased: the memoized base list must not accumulate an entry on every request.
  const missingKeys = [...baseMissing];
  // Normalized once here; everything downstream may assume a present key holds a real value.
  const overrides = normalizeOverrides(raw);
  const providers: Providers = {
    llm,
    search,
    image: buildImageProvider(missingKeys, overrides),
    video: buildVideoProvider(missingKeys, overrides),
  };
  return { providers, missingKeys };
}
