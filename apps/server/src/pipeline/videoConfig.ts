/** Guards - video quota burns far faster than images, so every knob defaults safe. */

import { boolConfig, intConfig, strConfig } from "../config/index.js";

/** Master switch. Nothing calls the video provider unless this is explicitly enabled. */
export function isVideoEnabled(): boolean {
  return boolConfig("VIDEO_ENABLED", (c) => c.video?.enabled, false);
}

export function getVideoMaxPerSession(): number {
  return intConfig("VIDEO_MAX_PER_SESSION", (c) => c.video?.maxPerSession, 5);
}

/** Exported so the settings catalog builds its dropdown from this one list rather than repeating it. */
export const RESOLUTIONS = ["480p", "720p", "1080p"] as const;
export type VideoResolution = (typeof RESOLUTIONS)[number];

function isResolution(raw: string | undefined): raw is VideoResolution {
  return raw !== undefined && (RESOLUTIONS as readonly string[]).includes(raw);
}

/**
 * Dev default 480p - never 1080p in this session.
 *
 * `override` is the UI picker's value for one request. Anything outside the accepted set falls
 * through to the configured value instead of reaching the provider, matching how the image
 * providers treat their own closed-set overrides. Called with no argument this behaves exactly as
 * it did before overrides existed.
 */
export function getVideoResolution(override?: string): VideoResolution {
  if (isResolution(override)) return override;
  const raw = strConfig("VIDEO_RESOLUTION", (c) => c.video?.resolution, "480p");
  return isResolution(raw) ? raw : "480p";
}

/**
 * Hard ceiling on a *client-supplied* duration.
 *
 * Video burns quota far faster than images and the generate endpoint has no auth, so a hand-made
 * request must not be able to order a minute of footage. The value configured in `config.yml` is
 * deliberately NOT capped: an operator editing that file is making a considered choice, whereas a
 * number arriving over HTTP is not.
 */
export const MAX_OVERRIDE_DURATION_SECONDS = 12;

export function getVideoDurationSeconds(override?: number): number {
  if (override !== undefined && Number.isFinite(override) && override > 0) {
    return Math.min(Math.floor(override), MAX_OVERRIDE_DURATION_SECONDS);
  }
  return intConfig("VIDEO_DURATION_SECONDS", (c) => c.video?.durationSeconds, 5);
}
