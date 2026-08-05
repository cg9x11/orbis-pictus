import { MockLlmProvider } from "./llm/mock.js";
import { GeminiLlmProvider } from "./llm/gemini.js";
import { AnthropicLlmProvider } from "./llm/anthropic.js";
import { MockImageProvider } from "./image/mock.js";
import { FalImageProvider } from "./image/fal.js";
import { NoneSearchProvider } from "./search/none.js";
import { LlmSearchProvider } from "./search/llm.js";
import type { ImageProvider, LlmProvider, SearchProvider } from "./types.js";

export interface Providers {
  llm: LlmProvider;
  image: ImageProvider;
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

  const apiKey = process.env.FAL_KEY;
  if (!apiKey) {
    missingKeys.push("FAL_KEY");
    return new MockImageProvider();
  }
  return new FalImageProvider(apiKey, process.env.IMAGE_MODEL || "fal-ai/flux/schnell");
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
    search: buildSearchProvider(),
  };
}

/** Populated as a side effect of createProviders(); read after calling it once at startup. */
export function getMissingKeys(): string[] {
  return missingKeys;
}
