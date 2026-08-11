/** Guards for page-transition morphs - same guard shape as videoConfig.ts (idle
 *  loops), kept as a separate flag/cap so the two experimental features can be enabled and
 *  budgeted independently even though they share the same Ark video quota. */

import { boolConfig, intConfig, optStrConfig } from "../config/index.js";

/** Master switch. Nothing calls the video provider for a morph unless this is explicitly enabled. */
export function isMorphEnabled(): boolean {
  return boolConfig("MORPH_ENABLED", (c) => c.video?.morph?.enabled, false);
}

export function getMorphMaxPerSession(): number {
  return intConfig("MORPH_MAX_PER_SESSION", (c) => c.video?.morph?.maxPerSession, 5);
}

/** Whether to re-encode each finished morph backwards (ffmpeg) so stepping back up to the parent can
 *  play the same transition in reverse. Costs no video quota - it is a local re-encode - but it does
 *  need ffmpeg on PATH, so it is switchable for a host without it, and the tests turn it off rather
 *  than spawning a real process per case. Off just means back-navigation crossfades instead. */
export function isMorphReverseEnabled(): boolean {
  return boolConfig("MORPH_REVERSE", (c) => c.video?.morph?.reverse, true);
}

/** Whether an EDIT (a new version of a page) also generates a transition morph between the two
 *  versions. Off by default: most edits are small text/style tweaks where a full repaint clip is not
 *  worth the video quota, and stepping between versions crossfades fine without one. Independent of
 *  the master `MORPH_ENABLED` switch - even with morphs on, tap transitions still generate while edit
 *  transitions stay off until this is turned on. A tap (edited_from_id absent) is never gated here. */
export function isEditMorphEnabled(): boolean {
  return boolConfig("MORPH_EDIT_ENABLED", (c) => c.video?.morph?.editEnabled, false);
}

/** Model to run morphs on, when it must differ from the idle-loop model. Morphs are first-last-frame
 *  (`flf2v`) tasks, which some fast video models (e.g. seedance-1-0-pro-fast) don't support even
 *  though they handle the single-frame idle loop; set ARK_VIDEO_MORPH_MODEL to a flf2v-capable model
 *  in that case. Undefined (unset) means "use the provider's configured ARK_VIDEO_MODEL". */
export function getMorphVideoModel(): string | undefined {
  return optStrConfig("ARK_VIDEO_MORPH_MODEL", (c) => c.video?.morph?.model);
}
