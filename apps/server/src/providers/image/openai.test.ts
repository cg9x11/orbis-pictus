import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenAiImageProvider } from "./openai.js";
import { QuotaExhaustedError, type ImageGenInput } from "../types.js";

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

test("openai: a response with no image data throws a clear error", async () => {
  await withFetch({ status: 200, body: { data: [] } }, async () => {
    const provider = new OpenAiImageProvider("k", base, "gpt-image-1.5", "medium");
    await assert.rejects(() => provider.generate(input), /missing image data/);
  });
});
