import type { ImageProvider } from "../types.js";

/**
 * The UI-selected overrides an image factory may honour for one request, keyed exactly as
 * `ProviderOverrides` in ../index.ts so the request's bag passes straight through with no mapping
 * layer in between.
 *
 * Two things are guaranteed by the time a factory sees this: blank/whitespace values have already
 * been dropped (normalized once in ../index.ts), so a present key always holds a real value and a
 * factory can simply write `overrides.imageModel ?? strConfig(...)`; and `imageProvider` has already
 * been consumed by the registry to choose which factory runs, so factories ignore it.
 *
 * Each factory reads only the keys that mean something to it — an override aimed at a different
 * provider is simply not looked at.
 */
export interface ImageOverrides {
  imageProvider?: string;
  imageModel?: string;
  arkFallbackModel?: string;
  geminiImageSize?: string;
  openaiImageQuality?: string;
}

/**
 * What an image-provider factory can report back to the app while building itself. A factory pushes
 * a human-readable "what's missing" note here when a required secret/config is absent, then returns
 * null so the registry falls back to the mock provider — the same missing-key contract the whole
 * app already surfaces at startup.
 */
export interface ImageProviderContext {
  reportMissing(label: string): void;
  /** This request's provider/model overrides. Empty object when the caller supplied none. */
  readonly overrides: ImageOverrides;
}

/**
 * A self-describing image provider.
 *
 * This is the extension point for image generation: to add a provider (Cloudflare, Replicate, a new
 * Gemini/OpenAI model, …) you write one file that exports an `ImageProviderFactory` and add it to the
 * array in ./index.ts — no `if/else`/`switch` to edit. `id` is matched against the active provider
 * name (config.yml `image.provider` / env `IMAGE_PROVIDER`). Each factory owns its own secret lookup
 * (from the environment) and non-secret config (via the config helpers), keeping everything about a
 * provider in one place. `build` returns null to mean "selected but not configured" (a missing key),
 * which the registry turns into the mock so the app still runs.
 */
export interface ImageProviderFactory {
  readonly id: string;
  build(ctx: ImageProviderContext): ImageProvider | null;
}
