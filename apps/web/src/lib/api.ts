import type {
  AspectRatio,
  CachedTap,
  ConfigResponse,
  GenerateEvent,
  GenerateRequest,
  Node,
  NodesGetResponse,
  NodesListResponse,
  NodeTapsResponse,
} from "@flipbook/shared";
import { ConfigResponseSchema, GenerateEventSchema } from "@flipbook/shared";
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
 * Points on this page that have already been explored and whose child page still exists (PLAN
 * §2.3). Tapping one opens that child immediately with no generation, so they are worth marking
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
 * Already-generated nodes for the landing-page example gallery — zero new generations
 * (PLAN §3 Phase 3). Pass `"all"` to load the whole gallery with no cap; a number is clamped
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
  // omits e.g. `houseStyles` would otherwise leave it undefined and crash HouseStylePicker's
  // `styles.length`. The `.default([])`/`.default(false)` exist precisely to degrade gracefully.
  return ConfigResponseSchema.parse(await res.json());
}

/** Idle-loop video (PLAN §3 Phase 5): null until the background clip is ready — the caller polls with backoff. */
export async function fetchNodeVideo(id: string): Promise<string | null> {
  const res = await fetch(`/api/nodes/${id}/video`);
  if (!res.ok) return null;
  const { video_url } = (await res.json()) as { ready: true; video_url: string };
  return video_url;
}

/**
 * On-demand idle-loop generation (PLAN §3 Phase 5): asks the server to make a clip for a page that
 * was created without one (Live video was off at the time). Returns "pending" once generation is
 * under way (the caller then polls via fetchNodeVideo) or "ready" if one already existed; throws
 * with the server's message on a real failure (disabled, session cap, no image to animate).
 */
export async function requestNodeVideo(id: string): Promise<{ status: "pending" | "ready"; video_url?: string }> {
  const res = await fetch(`/api/nodes/${id}/video`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error((body as { error?: string } | null)?.error ?? `Couldn't start video generation (${res.status})`);
  }
  return res.json();
}

/**
 * Transition morph (PLAN §3 Phase 5): a single non-blocking check, never polled — morphs are
 * pre-generated in the background and either exist by the time you navigate here or they don't;
 * null just means "play the instant crossfade instead", not "come back later".
 */
export async function fetchNodeMorph(id: string): Promise<string | null> {
  const res = await fetch(`/api/nodes/${id}/morph`);
  if (!res.ok) return null;
  const { morph_url } = (await res.json()) as { ready: true; morph_url: string };
  return morph_url;
}

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
