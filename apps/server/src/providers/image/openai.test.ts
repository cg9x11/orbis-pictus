import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenAiImageProvider } from "./openai.js";
import { buildImageProvider } from "./index.js";
import { QuotaExhaustedError, UnknownModelError, type ImageGenInput } from "../types.js";

/** Sets env vars for the duration of `run`, restoring exactly what was there before (including
 *  "was not set at all") - mirrors the helper in ./gemini.test.ts. */
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

const base = "https://openai.example.com/v1";
const input: ImageGenInput = { prompt: "a felt diorama of pho", aspectRatio: "3:4" };
const okBody = {
  data: [{ b64_json: Buffer.from("openai-img").toString("base64") }],
  usage: { input_tokens: 20, output_tokens: 1568, total_tokens: 1588 },
};

test("openai: posts to /images/generations with bearer auth, mapped size, and quality; decodes b64_json", async () => {
  await withFetch({ status: 200, body: okBody }, async (calls) => {
    const provider = new OpenAiImageProvider("test-key", base, "gpt-image-1.5", "high");
    const result = await provider.generate(input);

    assert.equal(result.bytes.toString(), "openai-img");
    assert.equal(result.contentType, "image/png");
    assert.deepEqual(result.usage, { inputTokens: 20, outputTokens: 1568, totalTokens: 1588 });

    assert.equal(calls[0]!.url, `${base}/images/generations`);
    const headers = calls[0]!.init!.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer test-key");
    const body = JSON.parse(calls[0]!.init!.body as string);
    assert.equal(body.model, "gpt-image-1.5");
    assert.equal(body.size, "1024x1536"); // 3:4 -> portrait
    assert.equal(body.quality, "high");
  });
});

test("openai: a 429 surfaces as QuotaExhaustedError", async () => {
  await withFetch({ status: 429, body: { error: { message: "rate limited" } } }, async () => {
    const provider = new OpenAiImageProvider("k", base, "gpt-image-1.5", "medium");
    await assert.rejects(() => provider.generate(input), (err) => err instanceof QuotaExhaustedError);
  });
});

test("openai: a model-shaped 404 surfaces as UnknownModelError", async () => {
  // Shape taken from OpenAI's published error contract, NOT captured live - the key is empty here.
  const body = { error: { code: "model_not_found", message: "The model 'gpt-image-9' does not exist", type: "invalid_request_error" } };
  await withFetch({ status: 404, body }, async () => {
    const provider = new OpenAiImageProvider("k", base, "gpt-image-9", "medium");
    await assert.rejects(() => provider.generate(input), UnknownModelError);
  });
});

test("openai: a 404 that says nothing about a model stays a plain error", async () => {
  // A wrong base URL looks like this, and a different model would not fix it - so it must not be
  // rerouted into a model fallback that spends a second request to fail the same way.
  await withFetch({ status: 404, body: { error: { message: "Unknown request URL" } } }, async () => {
    const provider = new OpenAiImageProvider("k", base, "gpt-image-1.5", "medium");
    await assert.rejects(
      () => provider.generate(input),
      (err: unknown) => err instanceof Error && !(err instanceof UnknownModelError),
    );
  });
});

test("openai: a response with no image data throws a clear error", async () => {
  await withFetch({ status: 200, body: { data: [] } }, async () => {
    const provider = new OpenAiImageProvider("k", base, "gpt-image-1.5", "medium");
    await assert.rejects(() => provider.generate(input), /missing image data/);
  });
});

// --- Per-request overrides, exercised through the registry (the UI picker's real path) ---

const openaiEnv = { IMAGE_PROVIDER: "openai", OPENAI_API_KEY: "o-key", OPENAI_IMAGE_BASE_URL: base };

test("openai: the factory honours the request's model and quality overrides", async () => {
  await withEnv(openaiEnv, async () => {
    await withFetch({ status: 200, body: okBody }, async (calls) => {
      const provider = buildImageProvider([], { imageModel: "gpt-image-2", openaiImageQuality: "low" });
      assert.equal(provider.modelId, "gpt-image-2");

      await provider.generate(input);
      const body = JSON.parse(calls[0]!.init!.body as string);
      assert.equal(body.model, "gpt-image-2");
      assert.equal(body.quality, "low");
    });
  });
});

test("openai: a quality override outside the accepted set falls through to the configured value", async () => {
  await withEnv(openaiEnv, async () => {
    await withFetch({ status: 200, body: okBody }, async (calls) => {
      // "ultra" is not a quality the API accepts; it must never be sent.
      await buildImageProvider([], { openaiImageQuality: "ultra" }).generate(input);
      assert.equal(JSON.parse(calls[0]!.init!.body as string).quality, "medium");
    });
  });
});
