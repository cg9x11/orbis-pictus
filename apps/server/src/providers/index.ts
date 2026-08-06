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

const missingKeys: string[] = [];

function buildLlmProvider(): LlmProvider {
  const provider = process.env.LLM_PROVIDER ?? (process.env.LLM_API_KEY ? "anthropic" : "gemini");
  if (provider === "mock") return new MockLlmProvider();

  if (provider === "anthropic") {
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

  // provider === "gemini" (default)
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    missingKeys.push("GEMINI_API_KEY");
    return new MockLlmProvider();
  }
  return new GeminiLlmProvider(apiKey);
}

function buildImageProvider(): ImageProvider {
  const provider = process.env.IMAGE_PROVIDER ?? "fal";
  if (provider === "mock") return new MockImageProvider();

  if (provider === "ark") {
    const parsed = ArkConfigSchema.safeParse({
      ARK_API_KEY: process.env.ARK_API_KEY,
      ARK_BASE_URL: process.env.ARK_BASE_URL || "https://ark.ap-southeast.bytepluses.com",
      ARK_IMAGE_MODEL: process.env.ARK_IMAGE_MODEL || "seedream-4-5-251128",
      ARK_IMAGE_MODEL_FALLBACK: process.env.ARK_IMAGE_MODEL_FALLBACK || "seedream-4-0-250828",
    });
    if (!parsed.success) {
      missingKeys.push(`ARK_API_KEY/config (${parsed.error.issues.map((i) => i.path.join(".")).join(", ")})`);
      return new MockImageProvider();
    }
    const { ARK_API_KEY, ARK_BASE_URL, ARK_IMAGE_MODEL, ARK_IMAGE_MODEL_FALLBACK } = parsed.data;
    return new ArkImageProvider(ARK_API_KEY, ARK_BASE_URL, ARK_IMAGE_MODEL, ARK_IMAGE_MODEL_FALLBACK);
  }

  const apiKey = process.env.FAL_KEY;
  if (!apiKey) {
    missingKeys.push("FAL_KEY");
    return new MockImageProvider();
  }
  return new FalImageProvider(apiKey, process.env.IMAGE_MODEL || "fal-ai/flux/schnell");
}

function buildVideoProvider(): VideoProvider {
  // Defaults to "mock" even when ARK_API_KEY is already set (unlike LLM/image), because video is
  // an opt-in experimental feature gated separately by VIDEO_ENABLED (PLAN §3 Phase 5) — a user
  // shouldn't start burning real video quota just because they already configured Ark for images.
  const provider = process.env.VIDEO_PROVIDER ?? "mock";
  if (provider !== "ark") return new MockVideoProvider();

  const parsed = ArkVideoConfigSchema.safeParse({
    ARK_API_KEY: process.env.ARK_API_KEY,
    ARK_BASE_URL: process.env.ARK_BASE_URL || "https://ark.ap-southeast.bytepluses.com",
    ARK_VIDEO_MODEL: process.env.ARK_VIDEO_MODEL || "seedance-1-0-pro-250528",
  });
  if (!parsed.success) {
    missingKeys.push(`ARK_API_KEY/config for video (${parsed.error.issues.map((i) => i.path.join(".")).join(", ")})`);
    return new MockVideoProvider();
  }
  const { ARK_API_KEY, ARK_BASE_URL, ARK_VIDEO_MODEL } = parsed.data;
  return new ArkVideoProvider(ARK_API_KEY, ARK_BASE_URL, ARK_VIDEO_MODEL);
}

function buildSearchProvider(): SearchProvider {
  const provider = process.env.SEARCH_PROVIDER ?? (process.env.LLM_API_KEY ? "llm" : "none");
  if (provider === "llm") {
    const apiKey = process.env.LLM_API_KEY;
    if (!apiKey) {
      missingKeys.push("LLM_API_KEY (for SEARCH_PROVIDER=llm)");
      return new NoneSearchProvider();
    }
    const baseURL = process.env.LLM_BASE_URL || "http://localhost:20128";
    const searchModel = process.env.SEARCH_MODEL || "cc/claude-sonnet-5";
    return new LlmSearchProvider(apiKey, baseURL, searchModel);
  }
  return new NoneSearchProvider();
}

export function createProviders(): Providers {
  return {
    llm: buildLlmProvider(),
    image: buildImageProvider(),
    video: buildVideoProvider(),
    search: buildSearchProvider(),
  };
}

/** Populated as a side effect of createProviders(); read after calling it once at startup. */
export function getMissingKeys(): string[] {
  return missingKeys;
}
