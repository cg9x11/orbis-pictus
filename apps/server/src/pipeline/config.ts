import { boolConfig, strConfig } from "../config/index.js";

export type TapDedupMode = "reuse" | "variant" | "off";

/**
 * PLAN §2.3: reuse (default) uses both the VLM coordinate cache and subject-level child dedup;
 * variant keeps the VLM cache but always regenerates a fresh child; off disables both caches,
 * matching the original's always-fresh behavior (PLAN §1.6).
 */
export function getTapDedupMode(): TapDedupMode {
  const raw = strConfig("TAP_DEDUP", (c) => c.tapDedup, "reuse");
  return raw === "variant" || raw === "off" ? raw : "reuse";
}

/**
 * Whether users may upload their own photo as a root page (PLAN §3 Phase 2). Off by default:
 * an upload accepts an arbitrary user-supplied image and stores it verbatim, so a public
 * deployment should opt in deliberately rather than have it open. Same explicit-"true" shape as
 * VIDEO_ENABLED / MORPH_ENABLED.
 */
export function isUploadEnabled(): boolean {
  return boolConfig("UPLOAD_ENABLED", (c) => c.upload?.enabled, false);
}
