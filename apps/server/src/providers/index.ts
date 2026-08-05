import { MockLlmProvider } from "./llm/mock.js";
import { GeminiLlmProvider } from "./llm/gemini.js";
import { MockImageProvider } from "./image/mock.js";
import { FalImageProvider } from "./image/fal.js";
import { NoneSearchProvider } from "./search/none.js";
import type { ImageProvider, LlmProvider, SearchProvider } from "./types.js";

export interface Providers {
  llm: LlmProvider;
  image: ImageProvider;
  search: SearchProvider;
}

const missingKeys: string[] = [];

function buildLlmProvider(): LlmProvider {
  const provider = process.env.LLM_PROVIDER ?? "gemini";
  if (provider === "mock") return new MockLlmProvider();

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
