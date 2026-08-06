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
