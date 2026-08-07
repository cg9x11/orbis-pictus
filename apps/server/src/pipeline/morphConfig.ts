/** PLAN §3 Phase 5 guards for page-transition morphs — same guard shape as videoConfig.ts (idle
 *  loops), kept as a separate flag/cap so the two experimental features can be enabled and
 *  budgeted independently even though they share the same Ark video quota. */

import { boolEnvFlag, positiveIntEnv } from "../lib/env.js";

/** Master switch. Nothing calls the video provider for a morph unless this is explicitly "true". */
export function isMorphEnabled(): boolean {
  return boolEnvFlag("MORPH_ENABLED");
}

export function getMorphMaxPerSession(): number {
  return positiveIntEnv("MORPH_MAX_PER_SESSION", 5);
}

/** Model to run morphs on, when it must differ from the idle-loop model. Morphs are first-last-frame
 *  (`flf2v`) tasks, which some fast video models (e.g. seedance-1-0-pro-fast) don't support even
 *  though they handle the single-frame idle loop; set ARK_VIDEO_MORPH_MODEL to a flf2v-capable model
 *  in that case. Undefined (unset) means "use the provider's configured ARK_VIDEO_MODEL". */
export function getMorphVideoModel(): string | undefined {
  return process.env.ARK_VIDEO_MORPH_MODEL || undefined;
}
