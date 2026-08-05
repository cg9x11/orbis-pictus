export type TapDedupMode = "reuse" | "variant" | "off";

/**
 * PLAN §2.3: reuse (default) uses both the VLM coordinate cache and subject-level child dedup;
 * variant keeps the VLM cache but always regenerates a fresh child; off disables both caches,
 * matching the original's always-fresh behavior (PLAN §1.6).
 */
export function getTapDedupMode(): TapDedupMode {
  const raw = process.env.TAP_DEDUP;
  return raw === "variant" || raw === "off" ? raw : "reuse";
}
