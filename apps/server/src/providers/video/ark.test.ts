import { test } from "node:test";
import assert from "node:assert/strict";
import { ArkVideoProvider } from "./ark.js";
import type { VideoGenInput } from "../types.js";

interface FakeResponse {
  status: number;
  body: unknown;
  isVideoDownload?: boolean;
}

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

/** Stubs global.fetch with a canned sequence of responses, recording every call, and restores it after. */
function withFetchSequence(responses: FakeResponse[], run: (calls: RecordedCall[]) => Promise<void>): Promise<void> {
  const calls: RecordedCall[] = [];
  const original = globalThis.fetch;
  let index = 0;
  // @ts-expect-error -- test stub, signature intentionally narrower than the real fetch overload set
  globalThis.fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = responses[index];
    index++;
    if (!next) throw new Error(`Unexpected extra fetch call: ${url}`);
    if (next.isVideoDownload) {
      return new Response(Buffer.from("real-mp4-bytes"), { status: next.status, headers: { "content-type": "video/mp4" } });
    }
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { "content-type": "application/json" } });
  };
  return run(calls).finally(() => {
    globalThis.fetch = original;
  });
}

const input: VideoGenInput = {
  prompt: "gentle ambient motion",
  aspectRatio: "16:9",
  firstFrameDataUrl: "data:image/jpeg;base64,Zm9v",
  durationSeconds: 5,
  resolution: "480p",
};

test("generate(): full create -> poll -> download flow, using fixtures captured from a real Ark call (PLAN §2 Video findings)", async () => {
  // Only one poll iteration (straight to "succeeded") to keep this test fast — the multi-iteration
  // backoff/timing behavior itself is covered in isolation by lib/poll.test.ts with an injected
  // fast sleep; this test's job is verifying request/response *shape* fidelity against real fixtures.
  await withFetchSequence(
    [
      { status: 200, body: { id: "cgt-20260806060039-7rxl8" } },
      {
        status: 200,
        body: {
          id: "cgt-20260806060039-7rxl8",
          model: "seedance-1-0-pro-250528",
          status: "succeeded",
          content: { video_url: "https://example.com/loop.mp4?signed=1" },
          resolution: "480p",
          ratio: "16:9",
          duration: 5,
        },
      },
      { status: 200, body: null, isVideoDownload: true },
    ],
    async (calls) => {
      const provider = new ArkVideoProvider("test-key", "https://ark.example.com/", "seedance-1-0-pro-250528");
      const result = await provider.generate({ ...input, resolution: "480p" });

      assert.equal(result.contentType, "video/mp4");
      assert.equal(result.bytes.toString(), "real-mp4-bytes");

      assert.equal(calls.length, 3);
      assert.equal(calls[0]!.url, "https://ark.example.com/api/v3/contents/generations/tasks");
      const createBody = JSON.parse(calls[0]!.init!.body as string);
      assert.equal(createBody.model, "seedance-1-0-pro-250528");
      assert.equal(createBody.content[0].type, "text");
      assert.match(createBody.content[0].text, /--resolution 480p --duration 5 --ratio 16:9 --watermark false --camerafixed true$/);
      assert.deepEqual(createBody.content[1], { type: "image_url", image_url: { url: input.firstFrameDataUrl } });

      assert.equal(calls[1]!.url, "https://ark.example.com/api/v3/contents/generations/tasks/cgt-20260806060039-7rxl8");
      assert.equal(calls[2]!.url, "https://example.com/loop.mp4?signed=1");
    },
  );
});

// A morph runs on a different (flf2v-capable) model than the idle loop via input.modelOverride,
// without constructing a second provider — the create body must carry the override, not the
// provider's own configured model.
test("generate(): input.modelOverride wins over the provider's configured model in the create body", async () => {
  await withFetchSequence(
    [
      { status: 200, body: { id: "cgt-ov" } },
      { status: 200, body: { id: "cgt-ov", status: "succeeded", content: { video_url: "https://example.com/m.mp4" } } },
      { status: 200, body: null, isVideoDownload: true },
    ],
    async (calls) => {
      const provider = new ArkVideoProvider("test-key", "https://ark.example.com", "seedance-1-0-pro-fast");
      await provider.generate({ ...input, lastFrameDataUrl: "data:image/jpeg;base64,YmFy", modelOverride: "seedance-1-0-pro-250528" });
      const createBody = JSON.parse(calls[0]!.init!.body as string);
      assert.equal(createBody.model, "seedance-1-0-pro-250528");
    },
  );
});

test("generate(): a quota/rate-limit error at task creation is surfaced distinguishably, not hung", async () => {
  await withFetchSequence(
    [{ status: 429, body: { error: { code: "TooManyRequests", message: "rate limit exceeded" } } }],
    async () => {
      const provider = new ArkVideoProvider("test-key", "https://ark.example.com", "seedance-1-0-pro-250528");
      await assert.rejects(() => provider.generate(input), /Video quota exhausted/);
    },
  );
});

test("generate(): a non-quota request error (e.g. ModelNotOpen) is surfaced with its own message", async () => {
  await withFetchSequence(
    [{ status: 404, body: { error: { code: "ModelNotOpen", message: "has not activated the model" } } }],
    async () => {
      const provider = new ArkVideoProvider("test-key", "https://ark.example.com", "seedance-1-0-pro-250528");
      await assert.rejects(() => provider.generate(input), /has not activated the model/);
    },
  );
});

// A single transient HTTP error on a *status poll* (not task creation) must not abort a task that
// is still succeeding server-side — the whole clip used to fail on one momentary 5xx/429. Here the
// second poll 503s, then the third succeeds; generate() should ride through it. (Incurs one real
// backoff sleep — the poll timing itself is covered fast in lib/poll.test.ts.)
test("generate(): a transient 503 during status polling is retried, not treated as failure", async () => {
  await withFetchSequence(
    [
      { status: 200, body: { id: "cgt-2" } },
      { status: 503, body: { error: { message: "upstream temporarily unavailable" } } },
      { status: 200, body: { id: "cgt-2", status: "succeeded", content: { video_url: "https://example.com/ok.mp4" } } },
      { status: 200, body: null, isVideoDownload: true },
    ],
    async (calls) => {
      const provider = new ArkVideoProvider("test-key", "https://ark.example.com", "seedance-1-0-pro-250528");
      const result = await provider.generate(input);
      assert.equal(result.bytes.toString(), "real-mp4-bytes");
      assert.equal(calls.length, 4); // create, failed poll, retried poll, download
    },
  );
});

// The retry tolerance is scoped to transient statuses: a clearly terminal status (e.g. the task id
// is gone / unauthorized) on a poll still aborts rather than spinning to the poll timeout.
test("generate(): a terminal 404 during status polling aborts instead of retrying", async () => {
  await withFetchSequence(
    [
      { status: 200, body: { id: "cgt-3" } },
      { status: 404, body: { error: { code: "TaskNotFound", message: "no such task" } } },
    ],
    async () => {
      const provider = new ArkVideoProvider("test-key", "https://ark.example.com", "seedance-1-0-pro-250528");
      await assert.rejects(() => provider.generate(input), /no such task/);
    },
  );
});

test("generate(): a terminal non-succeeded task status throws instead of polling forever", async () => {
  await withFetchSequence(
    [
      { status: 200, body: { id: "cgt-1" } },
      { status: 200, body: { id: "cgt-1", status: "failed", error: { message: "content moderation rejected" } } },
    ],
    async () => {
      const provider = new ArkVideoProvider("test-key", "https://ark.example.com", "seedance-1-0-pro-250528");
      await assert.rejects(() => provider.generate(input), /content moderation rejected/);
    },
  );
});
