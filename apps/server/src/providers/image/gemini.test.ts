import { test } from "node:test";
import assert from "node:assert/strict";
import { GeminiImageProvider } from "./gemini.js";
import { buildImageProvider } from "./index.js";
import { QuotaExhaustedError, UnknownModelError, type ImageGenInput } from "../types.js";

/** Sets env vars for the duration of `run`, restoring exactly what was there before (including
 *  "was not set at all"). Used by the factory tests below, which go through the registry so the
 *  factory's override wiring is what gets exercised, not the provider constructor. */
function withEnv(vars: Record<string, string | undefined>, run: () => Promise<void>): Promise<void> {
  const previous = new Map<string, string | undefined>(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return run().finally(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

interface Recorded {
  url: string;
  init: RequestInit | undefined;
}

/** Stubs global.fetch with one canned response, recording the call, and restores it after. */
function withFetch(response: { status: number; body: unknown }, run: (calls: Recorded[]) => Promise<void>): Promise<void> {
  const calls: Recorded[] = [];
  const original = globalThis.fetch;
  // @ts-expect-error -- narrow test stub
  globalThis.fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  };
  return run(calls).finally(() => {
    globalThis.fetch = original;
  });
}

const base = "https://gemini.example.com/v1beta";
const input: ImageGenInput = { prompt: "a felt diorama of pho", aspectRatio: "16:9" };
const okBody = {
  candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: Buffer.from("gemini-img").toString("base64") } }] } }],
  usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 1120, totalTokenCount: 1132 },
};

test("gemini: posts to :generateContent with the api-key header, aspect ratio, and image modality; decodes inlineData", async () => {
  await withFetch({ status: 200, body: okBody }, async (calls) => {
    const provider = new GeminiImageProvider("test-key", base, "gemini-3.1-flash-lite-image", "1K");
    const result = await provider.generate(input);

    assert.equal(result.bytes.toString(), "gemini-img");
    assert.equal(result.contentType, "image/png");
    assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 1120, totalTokens: 1132 });

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, `${base}/models/gemini-3.1-flash-lite-image:generateContent`);
    const headers = calls[0]!.init!.headers as Record<string, string>;
    assert.equal(headers["x-goog-api-key"], "test-key");
    const body = JSON.parse(calls[0]!.init!.body as string);
    assert.equal(body.generationConfig.imageConfig.aspectRatio, "16:9");
    assert.equal(body.generationConfig.imageConfig.imageSize, "1K");
    assert.ok(body.generationConfig.responseModalities.includes("IMAGE"));
    assert.equal(body.contents[0].parts[0].text, "a felt diorama of pho");
  });
});

test("gemini: a reference image is sent as an inline-data part alongside the prompt", async () => {
  await withFetch({ status: 200, body: okBody }, async (calls) => {
    const provider = new GeminiImageProvider("k", base, "m", "1K");
    await provider.generate({ ...input, referenceImageDataUrl: "data:image/jpeg;base64,Zm9v" });
    const body = JSON.parse(calls[0]!.init!.body as string);
    const inlinePart = body.contents[0].parts.find((p: { inlineData?: { data?: string } }) => p.inlineData);
    assert.ok(inlinePart, "expected an inlineData part for the reference image");
    assert.equal(inlinePart.inlineData.data, "Zm9v");
    assert.equal(inlinePart.inlineData.mimeType, "image/jpeg");
  });
});

test("gemini: a 429 surfaces as QuotaExhaustedError", async () => {
  await withFetch({ status: 429, body: { error: { message: "rate limited" } } }, async () => {
    const provider = new GeminiImageProvider("k", base, "m", "1K");
    await assert.rejects(() => provider.generate(input), (err) => err instanceof QuotaExhaustedError);
  });
});

test("gemini: an unknown model surfaces as UnknownModelError, so the fallback can catch it", async () => {
  // Body captured verbatim from the live Gemini API on 2026-08-08 by requesting a nonexistent model.
  const notFound = {
    error: {
      code: 404,
      message:
        "models/gemini-does-not-exist-9 is not found for API version v1beta, or is not supported for generateContent. Call ModelService.ListModels to see the list of available models and their supported methods.",
      status: "NOT_FOUND",
    },
  };
  await withFetch({ status: 404, body: notFound }, async () => {
    const provider = new GeminiImageProvider("k", base, "gemini-does-not-exist-9", "1K");
    await assert.rejects(() => provider.generate(input), UnknownModelError);
  });
});

test("gemini: a rate limit stays a quota error, not an unknown-model error", async () => {
  await withFetch({ status: 429, body: { error: { message: "rate limited" } } }, async () => {
    const provider = new GeminiImageProvider("k", base, "m", "1K");
    await assert.rejects(() => provider.generate(input), QuotaExhaustedError);
  });
});

test("gemini: a response with no image part throws a clear error", async () => {
  await withFetch({ status: 200, body: { candidates: [{ content: { parts: [{ text: "sorry" }] } }] } }, async () => {
    const provider = new GeminiImageProvider("k", base, "m", "1K");
    await assert.rejects(() => provider.generate(input), /missing image data/);
  });
});

// --- Per-request overrides, exercised through the registry (the UI picker's real path) ---

const geminiEnv = { IMAGE_PROVIDER: "gemini", GEMINI_API_KEY: "g-key", GEMINI_IMAGE_BASE_URL: base };

test("gemini: the factory honours the request's model and imageSize overrides", async () => {
  await withEnv(geminiEnv, async () => {
    await withFetch({ status: 200, body: okBody }, async (calls) => {
      const provider = buildImageProvider([], { imageModel: "gemini-3-pro-image", geminiImageSize: "4K" });
      assert.equal(provider.modelId, "gemini-3-pro-image");

      await provider.generate(input);
      assert.equal(calls[0]!.url, `${base}/models/gemini-3-pro-image:generateContent`);
      assert.equal(JSON.parse(calls[0]!.init!.body as string).generationConfig.imageConfig.imageSize, "4K");
    });
  });
});

test("gemini: an imageSize override outside the accepted set falls through to the configured value", async () => {
  await withEnv(geminiEnv, async () => {
    await withFetch({ status: 200, body: okBody }, async (calls) => {
      // "8K" is not a size Gemini accepts; it must never reach the API.
      await buildImageProvider([], { geminiImageSize: "8K" }).generate(input);
      assert.equal(JSON.parse(calls[0]!.init!.body as string).generationConfig.imageConfig.imageSize, "1K");
    });
  });
});
