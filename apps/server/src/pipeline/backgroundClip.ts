import type { AspectRatio, Node } from "@flipbook/shared";
import type { Providers } from "../providers/index.js";
import { loadImageAsDataUrl } from "./imageStorage.js";
import { getVideoDurationSeconds, getVideoResolution } from "./videoConfig.js";

export interface BackgroundClipPipeline<TNode extends Node = Node> {
  maybeStart(node: TNode, providers: Providers, imagesDir: string): void;
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
}

/**
 * Shared control flow for PLAN §3 Phase 5's two background-clip features (idle-loop video,
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

    inFlight.add(node.id);
    sessionCounts.set(node.session_id, count + 1);
    config.markPending(node.id);

    void (async () => {
      try {
        const firstFrameDataUrl = loadImageAsDataUrl(imagesDir, request.firstFrameUrl);
        const lastFrameDataUrl = request.lastFrameUrl ? loadImageAsDataUrl(imagesDir, request.lastFrameUrl) : undefined;
        const { bytes } = await providers.video.generate({
          prompt: request.prompt,
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

  return { maybeStart };
}
