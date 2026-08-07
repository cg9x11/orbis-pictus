import { test } from "node:test";
import assert from "node:assert/strict";
import { GeminiImageProvider } from "./gemini.js";
import { QuotaExhaustedError, type ImageGenInput } from "../types.js";

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
};

test("gemini: posts to :generateContent with the api-key header, aspect ratio, and image modality; decodes inlineData", async () => {
  await withFetch({ status: 200, body: okBody }, async (calls) => {
    const provider = new GeminiImageProvider("test-key", base, "gemini-3.1-flash-lite-image", "1K");
    const result = await provider.generate(input);

    assert.equal(result.bytes.toString(), "gemini-img");
    assert.equal(result.contentType, "image/png");

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

test("gemini: a response with no image part throws a clear error", async () => {
  await withFetch({ status: 200, body: { candidates: [{ content: { parts: [{ text: "sorry" }] } }] } }, async () => {
    const provider = new GeminiImageProvider("k", base, "m", "1K");
    await assert.rejects(() => provider.generate(input), /missing image data/);
  });
});
