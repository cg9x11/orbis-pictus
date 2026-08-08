import type {
  AspectRatio,
  CachedTap,
  ConfigResponse,
  GenerateEvent,
  GenerateRequest,
  ModelOverrides,
  Node,
  NodesGetResponse,
  NodesListResponse,
  NodeTapsResponse,
} from "@orbis/shared";
import { ConfigResponseSchema, GenerateEventSchema } from "@orbis/shared";
import { parseSSEStream } from "./sse";

export async function streamGenerate(
  request: GenerateRequest,
  onEvent: (event: GenerateEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(request),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new Error(`Generate request failed (${res.status}): ${body}`);
  }

  await parseSSEStream(res, (eventName, data) => {
    const parsed = GenerateEventSchema.safeParse({ event: eventName, data: JSON.parse(data) });
    if (parsed.success) onEvent(parsed.data);
  });
}

export async function fetchNode(id: string): Promise<NodesGetResponse> {
  const res = await fetch(`/api/nodes/${id}`);
  if (!res.ok) throw new Error(`Node ${id} not found`);
  return res.json();
}

/**
 * Points on this page that have already been explored and whose child page still exists.
 * Tapping one opens that child immediately with no generation, so they are worth marking
 * on the image. Empty when the server is not in TAP_DEDUP=reuse mode.
 */
export async function fetchNodeTaps(id: string, ratio: AspectRatio): Promise<CachedTap[]> {
  const res = await fetch(`/api/nodes/${id}/taps?ratio=${encodeURIComponent(ratio)}`);
  if (!res.ok) throw new Error(`Failed to fetch cached taps for node ${id}`);
  const { taps } = (await res.json()) as NodeTapsResponse;
  return taps;
}

export async function fetchVariant(id: string, ratio: AspectRatio): Promise<Node> {
  const res = await fetch(`/api/nodes/${id}/variant?ratio=${encodeURIComponent(ratio)}`);
  if (!res.ok) throw new Error(`Failed to fetch ${ratio} variant for node ${id}`);
  const { node } = (await res.json()) as { node: Node };
  return node;
}

/**
 * Already-generated nodes for the landing-page example gallery — zero new generations.
 * Pass `"all"` to load the whole gallery with no cap; a number is clamped
 * server-side to MAX_GALLERY_LIMIT (24).
 */
export async function fetchGallery(limit: number | "all" = 8): Promise<Node[]> {
  const res = await fetch(`/api/nodes?limit=${encodeURIComponent(limit)}`);
  if (!res.ok) throw new Error("Failed to fetch gallery");
  const { nodes } = (await res.json()) as NodesListResponse;
  return nodes;
}

export async function fetchConfig(): Promise<ConfigResponse> {
  const res = await fetch("/api/config");
  if (!res.ok) throw new Error("Failed to fetch config");
  // Parse (not raw-cast) so the schema's defaults actually run: an older/mismatched server that
  // omits e.g. `artStyles` would otherwise leave it undefined and crash ArtStylePicker's
  // `styles.length`. The `.default([])`/`.default(false)` exist precisely to degrade gracefully.
  return ConfigResponseSchema.parse(await res.json());
}

/** Idle-loop video: null until the background clip is ready — the caller polls with backoff. */
export async function fetchNodeVideo(id: string): Promise<string | null> {
  const res = await fetch(`/api/nodes/${id}/video`);
  if (!res.ok) return null;
  const { video_url } = (await res.json()) as { ready: true; video_url: string };
  return video_url;
}

/**
 * On-demand idle-loop generation: asks the server to make a clip for a page that
 * was created without one (Live video was off at the time). Returns "pending" once generation is
 * under way (the caller then polls via fetchNodeVideo) or "ready" if one already existed; throws
 * with the server's message on a real failure (disabled, session cap, no image to animate).
 */
export async function requestNodeVideo(
  id: string,
  overrides: ModelOverrides = {},
): Promise<{ status: "pending" | "ready"; video_url?: string }> {
  const res = await fetch(`/api/nodes/${id}/video`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // Carries the settings panel's picks so "Animate page" uses the same provider/model/resolution
    // as a normal generation. The body is optional server-side; `{}` means "server defaults".
    body: JSON.stringify(overrides),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error((body as { error?: string } | null)?.error ?? `Couldn't start video generation (${res.status})`);
  }
  return res.json();
}

/**
 * On-demand morph generation — the counterpart to requestNodeVideo, for a child that was created
 * while Live video was off (or reopened from a cached tap marker, which never runs the generate
 * pipeline). Returns "pending" once generation is under way, or "ready" if one already existed;
 * throws with the server's message otherwise (disabled, session cap, or a root with no parent).
 */
export async function requestNodeMorph(
  id: string,
  overrides: ModelOverrides = {},
): Promise<{ status: "pending" | "ready"; morph_url?: string }> {
  const res = await fetch(`/api/nodes/${id}/morph`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(overrides),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error((body as { error?: string } | null)?.error ?? `Couldn't start morph generation (${res.status})`);
  }
  return res.json();
}

/**
 * Transition morph: a single non-blocking check, never polled — morphs are
 * pre-generated in the background and either exist by the time you navigate here or they don't;
 * null just means "play the instant crossfade instead", not "come back later".
 */
export async function fetchNodeMorph(id: string): Promise<{ url: string; reverseUrl: string | null } | null> {
  const res = await fetch(`/api/nodes/${id}/morph`);
  if (!res.ok) return null;
  const body = (await res.json()) as { ready: true; morph_url: string; reverse_url?: string | null };
  return { url: body.morph_url, reverseUrl: body.reverse_url ?? null };
}

// Pre-navigation clip gate (useOrbisController): unlike the non-blocking readers above, these
// deliberately hold the transition while a clip is still rendering. Cadence is tuned to real
// generation (~32s in the verified live test): wait a beat, then check every few seconds, and give
// up after the timeout so a stalled generation can never hang the transition indefinitely. The two
// clips are generated in parallel server-side, so the caller waits on both at once and this timeout
// bounds the pair, not each one.
const CLIP_WAIT_FIRST_MS = 4000;
const CLIP_WAIT_POLL_MS = 2500;
const CLIP_WAIT_TIMEOUT_MS = 60_000;

type ClipKind = "video" | "morph";
type ClipStatus = "pending" | "ready" | "failed";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** One status-aware read of a node's clip: its url once ready, or the pending/failed/absent status. */
async function fetchClipState(id: string, kind: ClipKind): Promise<{ status: ClipStatus | null; url: string | null }> {
  const res = await fetch(`/api/nodes/${id}/${kind}`);
  const body = (await res.json().catch(() => null)) as
    | { status?: ClipStatus | null; video_url?: string; morph_url?: string }
    | null;
  const url = body?.video_url ?? body?.morph_url ?? null;
  if (res.ok && url) return { status: "ready", url };
  return { status: body?.status ?? null, url: null };
}

/**
 * Blocks until the named clip for `id` is ready (resolving its url), or gives up — returning null —
 * the moment the server reports that generation `failed` or the overall timeout elapses. Used for
 * the first parent -> child step, where the transition is intentionally held so both the morph and
 * the idle loop are in hand before the new page is shown. A clip that was never started leaves its
 * status null, the caller never asks for it, and the transition stays instant.
 */
async function waitForClipReady(id: string, kind: ClipKind): Promise<string | null> {
  const deadline = Date.now() + CLIP_WAIT_TIMEOUT_MS;
  await sleep(CLIP_WAIT_FIRST_MS);
  for (;;) {
    const { status, url } = await fetchClipState(id, kind);
    if (url) return url;
    if (status === "failed") return null;
    if (Date.now() >= deadline) return null;
    await sleep(CLIP_WAIT_POLL_MS);
  }
}

export const waitForMorphReady = (id: string): Promise<string | null> => waitForClipReady(id, "morph");
export const waitForVideoReady = (id: string): Promise<string | null> => waitForClipReady(id, "video");

export async function uploadImage(image: string, aspectRatio: AspectRatio, sessionId: string): Promise<Node> {
  const res = await fetch("/api/nodes/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ image, aspect_ratio: aspectRatio, session_id: sessionId }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Upload failed (${res.status}): ${body}`);
  }
  const { node } = (await res.json()) as { node: Node };
  return node;
}
