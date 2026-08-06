/** PLAN §3 Phase 5 guards — video quota burns far faster than images, so every knob defaults safe. */

import { boolEnvFlag, positiveIntEnv } from "../lib/env.js";

/** Master switch. Nothing calls the video provider unless this is explicitly "true". */
export function isVideoEnabled(): boolean {
  return boolEnvFlag("VIDEO_ENABLED");
}

export function getVideoMaxPerSession(): number {
  return positiveIntEnv("VIDEO_MAX_PER_SESSION", 5);
}

const RESOLUTIONS = ["480p", "720p", "1080p"] as const;
export type VideoResolution = (typeof RESOLUTIONS)[number];

/** Dev default 480p — never 1080p in this session per PLAN §3 Phase 5. */
export function getVideoResolution(): VideoResolution {
  const raw = process.env.VIDEO_RESOLUTION;
  return (RESOLUTIONS as readonly string[]).includes(raw ?? "") ? (raw as VideoResolution) : "480p";
}

export function getVideoDurationSeconds(): number {
  const raw = Number(process.env.VIDEO_DURATION_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? raw : 5;
}
