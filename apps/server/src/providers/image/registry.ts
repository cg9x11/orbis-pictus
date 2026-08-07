import type { ImageProvider } from "../types.js";

/**
 * What an image-provider factory can report back to the app while building itself. A factory pushes
 * a human-readable "what's missing" note here when a required secret/config is absent, then returns
 * null so the registry falls back to the mock provider — the same missing-key contract the whole
 * app already surfaces at startup.
 */
export interface ImageProviderContext {
  reportMissing(label: string): void;
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
