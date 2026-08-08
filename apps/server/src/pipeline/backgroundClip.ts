import type { AspectRatio, Node } from "@flipbook/shared";
import type { Providers } from "../providers/index.js";
import { loadImageAsDataUrl } from "./imageStorage.js";
import { getVideoDurationSeconds, getVideoResolution } from "./videoConfig.js";

/**
 * Outcome of an on-demand `startNow` call, mapped to an HTTP response by the route that triggered it
 * (see routes/nodes.ts). Unlike `maybeStart`, which silently no-ops, an explicit user request wants
 * to know *why* nothing started so the UI can say so.
 */
export type StartNowResult =
  | "started" // a generation was kicked off; the node is now pending — poll for it
  | "already-pending" // one is already in flight (or the node is already pending) — poll for it
  | "already-ready" // a clip already exists for this node
  | "disabled" // the feature's master switch is off (e.g. VIDEO_ENABLED=false)
  | "session-cap" // this session has hit its per-session generation cap
  | "unavailable"; // buildRequest returned null (no usable image variant, no parent to morph, etc.)

export interface BackgroundClipPipeline<TNode extends Node = Node> {
  maybeStart(node: TNode, providers: Providers, imagesDir: string): void;
  /**
   * Explicit, user-triggered counterpart to `maybeStart`: starts a clip for a
   * node that doesn't have one yet, on demand rather than at creation time. Unlike `maybeStart` it
   * returns a result the caller can surface, and it will (re)start a node whose previous attempt
   * `failed` — a deliberate retry — while still refusing to double-start a `pending`/in-flight one,
   * to duplicate a `ready` one, when the master switch is off, or past the session cap.
   */
  startNow(node: TNode, providers: Providers, imagesDir: string): StartNowResult;
}

/** Identifies the clip request's content-only prompt and frame(s), by same-origin image URL
 *  (e.g. "/images/{nodeId}/landscape.jpg") — not yet loaded off disk. Loading happens inside the
 *  pipeline's own async/catch, same as the network call, so a missing/unreadable file fails this
 *  one background attempt (marked failed, logged) rather than throwing synchronously out of
 *  maybeStart and crashing whatever request triggered it. */
export interface ClipRequest {
  prompt: string;
  aspectRatio: AspectRatio;
  firstFrameUrl: string;
  lastFrameUrl?: string;
}

export interface BackgroundClipConfig<TNode extends Node> {
  /** Used in the error log line on a failed generation (e.g. "idle-loop video generation", "morph generation"). */
  label: string;
  isEnabled: () => boolean;
  maxPerSession: () => number;
  getStatus: (id: string) => { status: string | null } | null;
  /** Resolves this node's clip request, or null to skip — whatever precondition this clip type has
   *  (no usable image variant, no parent to morph from, no shared ratio between parent and child,
   *  etc). Synchronous and side-effect-free: no file I/O here, see ClipRequest. */
  buildRequest: (node: TNode) => ClipRequest | null;
  markPending: (id: string) => void;
  markReady: (id: string, url: string) => void;
  markFailed: (id: string) => void;
  save: (imagesDir: string, id: string, bytes: Buffer) => string;
  /** Optional per-clip-type video model override (e.g. morphs need a flf2v-capable model); when
   *  absent or returning undefined, the video provider uses its own configured model. */
  videoModel?: () => string | undefined;
  /** Optional: derive a scene-specific motion prompt from the loaded frame(s) via the VLM, replacing
   *  the static `request.prompt`. Runs inside the background task, where the frames are already in
   *  memory as data URLs. If it throws or returns empty, the pipeline falls back to `request.prompt`
   *  — a VLM hiccup must degrade to the generic prompt, never fail the clip. */
  describeMotion?: (
    frames: { firstFrameDataUrl: string; lastFrameDataUrl?: string },
    providers: Providers,
  ) => Promise<string | undefined>;
}

/**
 * Shared control flow for the two background-clip features (idle-loop video,
 * transition morph): same enabled / in-flight / already-attempted / session-cap guard chain, same
 * fire-and-forget generate -> save -> mark-ready/failed shape. They differ only in what "this
 * node's clip request" means (config.buildRequest) and where the result is written
 * (config.save/mark*) — see video.ts and morph.ts for the two concrete pipelines built on this.
 *
 * Factory (not a bare singleton) so tests can get isolated in-flight/session-cap state.
 */
export function createBackgroundClipPipeline<TNode extends Node>(config: BackgroundClipConfig<TNode>): BackgroundClipPipeline<TNode> {
  const inFlight = new Set<string>();
  const sessionCounts = new Map<string, number>();

  /** The actual generation, shared by both entry points: reserves the in-flight/session budget,
   *  marks the node pending, and runs the fire-and-forget generate -> save -> mark-ready/failed. */
  function launch(node: TNode, request: ClipRequest, providers: Providers, imagesDir: string): void {
    inFlight.add(node.id);
    sessionCounts.set(node.session_id, (sessionCounts.get(node.session_id) ?? 0) + 1);
    config.markPending(node.id);

    void (async () => {
      try {
        const firstFrameDataUrl = loadImageAsDataUrl(imagesDir, request.firstFrameUrl);
        const lastFrameDataUrl = request.lastFrameUrl ? loadImageAsDataUrl(imagesDir, request.lastFrameUrl) : undefined;

        // Tailor the motion prompt to what's actually in this page (VLM); fall back to the generic
        // static prompt if the VLM is unavailable or errors — the clip must still generate.
        let prompt = request.prompt;
        if (config.describeMotion) {
          try {
            const dynamic = await config.describeMotion({ firstFrameDataUrl, lastFrameDataUrl }, providers);
            if (dynamic && dynamic.trim()) prompt = dynamic.trim();
          } catch (err) {
            console.warn(`[flipbook] ${config.label}: motion-prompt generation failed, using generic fallback:`, err instanceof Error ? err.message : err);
          }
        }

        const { bytes } = await providers.video.generate({
          prompt,
          aspectRatio: request.aspectRatio,
          firstFrameDataUrl,
          lastFrameDataUrl,
          durationSeconds: getVideoDurationSeconds(),
          resolution: getVideoResolution(),
          modelOverride: config.videoModel?.(),
        });
        const url = config.save(imagesDir, node.id, bytes);
        config.markReady(node.id, url);
      } catch (err) {
        console.error(`[flipbook] ${config.label} failed for node ${node.id}:`, err instanceof Error ? err.message : err);
        config.markFailed(node.id);
      } finally {
        inFlight.delete(node.id);
      }
    })();
  }

  function maybeStart(node: TNode, providers: Providers, imagesDir: string): void {
    if (!config.isEnabled()) return;
    if (inFlight.has(node.id)) return;

    // A node that already has a stored clip (or already failed once) must never regenerate one.
    const info = config.getStatus(node.id);
    if (info?.status) return;

    const count = sessionCounts.get(node.session_id) ?? 0;
    if (count >= config.maxPerSession()) return;

    const request = config.buildRequest(node);
    if (!request) return;

    launch(node, request, providers, imagesDir);
  }

  function startNow(node: TNode, providers: Providers, imagesDir: string): StartNowResult {
    if (!config.isEnabled()) return "disabled";
    if (inFlight.has(node.id)) return "already-pending";

    // Unlike maybeStart, a truthy status is not a blanket "skip": ready/pending are, but a prior
    // `failed` is retryable here because this is an explicit user request, not an automatic attempt.
    const info = config.getStatus(node.id);
    if (info?.status === "ready") return "already-ready";
    if (info?.status === "pending") return "already-pending";

    const count = sessionCounts.get(node.session_id) ?? 0;
    if (count >= config.maxPerSession()) return "session-cap";

    const request = config.buildRequest(node);
    if (!request) return "unavailable";

    launch(node, request, providers, imagesDir);
    return "started";
  }

  return { maybeStart, startNow };
}
