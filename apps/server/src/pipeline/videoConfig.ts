/** Guards — video quota burns far faster than images, so every knob defaults safe. */

import { boolConfig, intConfig, strConfig } from "../config/index.js";

/** Master switch. Nothing calls the video provider unless this is explicitly enabled. */
export function isVideoEnabled(): boolean {
  return boolConfig("VIDEO_ENABLED", (c) => c.video?.enabled, false);
}

export function getVideoMaxPerSession(): number {
  return intConfig("VIDEO_MAX_PER_SESSION", (c) => c.video?.maxPerSession, 5);
}

const RESOLUTIONS = ["480p", "720p", "1080p"] as const;
export type VideoResolution = (typeof RESOLUTIONS)[number];

/** Dev default 480p — never 1080p in this session. */
export function getVideoResolution(): VideoResolution {
  const raw = strConfig("VIDEO_RESOLUTION", (c) => c.video?.resolution, "480p");
  return (RESOLUTIONS as readonly string[]).includes(raw) ? (raw as VideoResolution) : "480p";
}

export function getVideoDurationSeconds(): number {
  return intConfig("VIDEO_DURATION_SECONDS", (c) => c.video?.durationSeconds, 5);
}
