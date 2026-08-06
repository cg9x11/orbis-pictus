import type { VideoGenInput, VideoGenResult, VideoProvider } from "../types.js";
import { pollUntilDone, type PollOutcome } from "../../lib/poll.js";

const QUOTA_ERROR_PATTERN = /quota|rate.?limit|too many requests|exceeded|insufficient|overdue|throttl/i;

/** HTTP statuses worth retrying when they hit a *status poll* (not task creation): server errors,
 *  rate limiting, and request timeout are momentary and shouldn't abort a task that is very likely
 *  still succeeding server-side. Everything else (auth, not-found, bad request) is terminal. */
function isTransientPollStatus(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}

interface ArkErrorBody {
  error?: { code?: string; message?: string; type?: string };
}

class ArkVideoRequestError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, code: string | undefined, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }

  get isQuotaOrRateError(): boolean {
    if (this.status === 429) return true;
    return QUOTA_ERROR_PATTERN.test(`${this.code ?? ""} ${this.message}`);
  }
}

interface ArkTaskCreateResponse {
  id?: string;
}

interface ArkTaskStatusResponse {
  id: string;
  status: string; // "queued" | "running" | "succeeded" | "failed" | "cancelled" (only queued/running/succeeded verified live — PLAN §2)
  content?: { video_url?: string };
  error?: { message?: string };
}

/**
 * Generation parameters are dash-flags embedded in the text prompt (Midjourney-style), not
 * separate JSON fields — verified empirically 2026-08-06 (PLAN §2 Video findings).
 */
function buildDashParamPrompt(input: VideoGenInput): string {
  const flags = [
    `--resolution ${input.resolution}`,
    `--duration ${input.durationSeconds}`,
    `--ratio ${input.aspectRatio}`,
    "--watermark false",
    "--camerafixed true",
  ];
  return `${input.prompt} ${flags.join(" ")}`;
}

export class ArkVideoProvider implements VideoProvider {
  readonly modelId: string;
  readonly providerId = "ark";
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl: string, model: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.modelId = model;
  }

  async generate(input: VideoGenInput): Promise<VideoGenResult> {
    const taskId = await this.createTask(input);
    const videoUrl = await pollUntilDone((): Promise<PollOutcome<string>> => this.checkTask(taskId));
    return this.download(videoUrl);
  }

  private async createTask(input: VideoGenInput): Promise<string> {
    const content: Record<string, unknown>[] = [{ type: "text", text: buildDashParamPrompt(input) }];
    if (input.lastFrameDataUrl) {
      // Ark rejects multi-image content without a role distinguishing which frame is which
      // ("role must be specified for image contents", found live 2026-08-06, PLAN §2 Video
      // findings) — but the single-image idle-loop path was already verified working without a
      // role, so only add it once there are two images.
      content.push(
        { type: "image_url", image_url: { url: input.firstFrameDataUrl }, role: "first_frame" },
        { type: "image_url", image_url: { url: input.lastFrameDataUrl }, role: "last_frame" },
      );
    } else {
      content.push({ type: "image_url", image_url: { url: input.firstFrameDataUrl } });
    }

    const res = await fetch(`${this.baseUrl}/api/v3/contents/generations/tasks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: this.modelId, content }),
    });
    if (!res.ok) throw await this.toRequestError(res);

    const json = (await res.json()) as ArkTaskCreateResponse;
    if (!json.id) throw new Error(`Ark video task-create response missing id: ${JSON.stringify(json)}`);
    return json.id;
  }

  private async checkTask(taskId: string): Promise<PollOutcome<string>> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/v3/contents/generations/tasks/${taskId}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
    } catch (err) {
      // Network blip mid-poll: keep polling rather than failing the whole clip. pollUntilDone
      // still bounds retries by maxAttempts, so this can never hang.
      console.warn(`[ark-video] transient network error polling task ${taskId}, will retry:`, err);
      return { done: false };
    }
    if (!res.ok) {
      const err = await this.toRequestError(res);
      if (isTransientPollStatus(res.status)) {
        console.warn(`[ark-video] transient ${res.status} polling task ${taskId}, will retry: ${err.message}`);
        return { done: false };
      }
      throw err;
    }

    const json = (await res.json()) as ArkTaskStatusResponse;
    if (json.status === "succeeded") {
      const videoUrl = json.content?.video_url;
      if (!videoUrl) throw new Error(`Ark video task succeeded without a video_url: ${JSON.stringify(json)}`);
      return { done: true, value: videoUrl };
    }
    if (json.status === "queued" || json.status === "running") {
      return { done: false };
    }
    // Any other status (failed/cancelled/unrecognized) is treated as terminal failure — never hangs.
    return { done: true, failed: true, errorMessage: json.error?.message ?? `Ark video task ended with status "${json.status}"` };
  }

  private async download(videoUrl: string): Promise<VideoGenResult> {
    const res = await fetch(videoUrl);
    if (!res.ok) throw new Error(`Failed to download generated video (${res.status})`);
    const bytes = Buffer.from(await res.arrayBuffer());
    return { bytes, contentType: res.headers.get("content-type") ?? "video/mp4" };
  }

  private async toRequestError(res: Response): Promise<Error> {
    const text = await res.text();
    let parsed: ArkErrorBody | null = null;
    try {
      parsed = JSON.parse(text) as ArkErrorBody;
    } catch {
      // non-JSON error body, fall through with raw text
    }
    const err = new ArkVideoRequestError(res.status, parsed?.error?.code, parsed?.error?.message ?? `Ark video request failed (${res.status}): ${text}`);
    return err.isQuotaOrRateError ? new Error(`Video quota exhausted: ${err.message}`) : err;
  }
}
