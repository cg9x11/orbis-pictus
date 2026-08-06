/** PLAN §3 Phase 5 guards for page-transition morphs — same guard shape as videoConfig.ts (idle
 *  loops), kept as a separate flag/cap so the two experimental features can be enabled and
 *  budgeted independently even though they share the same Ark video quota. */

/** Master switch. Nothing calls the video provider for a morph unless this is explicitly "true". */
export function isMorphEnabled(): boolean {
  return process.env.MORPH_ENABLED === "true";
}

export function getMorphMaxPerSession(): number {
  const raw = Number(process.env.MORPH_MAX_PER_SESSION);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 5;
}
