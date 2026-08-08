import type { ImageProvider } from "../types.js";
import { strConfig } from "../../config/index.js";
import { MockImageProvider } from "./mock.js";
import { falImageFactory } from "./fal.js";
import { arkImageFactory } from "./ark.js";
import { geminiImageFactory } from "./gemini.js";
import { openaiImageFactory } from "./openai.js";
import type { ImageOverrides, ImageProviderFactory } from "./registry.js";

/**
 * The image-provider registry. This array is the single place to add an image provider — drop the
 * new provider's `ImageProviderFactory` in here (see ./registry.ts) and it's selectable by name via
 * config.yml `image.provider` / env `IMAGE_PROVIDER`. No control-flow changes anywhere else.
 */
const IMAGE_PROVIDER_FACTORIES: readonly ImageProviderFactory[] = [
  falImageFactory,
  arkImageFactory,
  geminiImageFactory,
  openaiImageFactory,
];

interface BuildAttempt {
  provider: ImageProvider | null;
  /** Why it failed: the name matches no factory ("unknown"), or it does but the factory reported
   *  a missing key/config ("unconfigured"). Absent when `provider` is non-null. */
  reason?: "unknown" | "unconfigured";
}

function buildByName(name: string, overrides: ImageOverrides, missingKeys: string[]): BuildAttempt {
  if (name === "mock") return { provider: new MockImageProvider() };
  const factory = IMAGE_PROVIDER_FACTORIES.find((f) => f.id === name);
  if (!factory) return { provider: null, reason: "unknown" };
  const built = factory.build({ reportMissing: (label) => missingKeys.push(label), overrides });
  return built ? { provider: built } : { provider: null, reason: "unconfigured" };
}

/**
 * Builds the image provider for one request: the UI-selected one when `overrides.imageProvider`
 * names something different, otherwise the configured default (`IMAGE_PROVIDER` / `image.provider`).
 *
 * The two paths fail differently, on purpose:
 *
 *  - **Configured path** (no override, or an override naming the already-configured provider):
 *    unchanged from before overrides existed — an unknown name or a missing key degrades to the
 *    mock and says so in `missingKeys`. Boot behaviour for a bad `config.yml` is deliberately not
 *    changed here; that is a separate decision.
 *  - **Override path**: falls back to the *configured provider*, never the mock. A mock silently
 *    returns placeholder art, which reads as a broken generation rather than a misconfiguration —
 *    much worse than quietly drawing with the provider the server is actually set up for. This
 *    matters because the catalog's `available` flag only protects the dropdown: a hand-typed
 *    Custom value or a stale client can still name a provider with no API key.
 */
export function buildImageProvider(missingKeys: string[], overrides: ImageOverrides = {}): ImageProvider {
  const configured = strConfig("IMAGE_PROVIDER", (c) => c.image?.provider, "fal");
  const requested = overrides.imageProvider;

  if (requested === undefined || requested === configured) {
    const attempt = buildByName(configured, overrides, missingKeys);
    if (attempt.provider) return attempt.provider;
    if (attempt.reason === "unknown") {
      missingKeys.push(`IMAGE_PROVIDER="${configured}" is not a known image provider (using mock)`);
    }
    return new MockImageProvider();
  }

  const attempt = buildByName(requested, overrides, missingKeys);
  if (attempt.provider) return attempt.provider;

  // console.warn for now; the fallback phase routes this to the client as a `notice` event so the
  // user sees why their pick didn't take, instead of only the server operator seeing it.
  console.warn(
    attempt.reason === "unknown"
      ? `[flipbook] Requested image provider "${requested}" is not a known provider — using "${configured}" instead.`
      : `[flipbook] Requested image provider "${requested}" has no API key configured — using "${configured}" instead.`,
  );

  // Rebuilt WITHOUT the request's model override: that model id was picked for the provider that
  // just failed and almost certainly means nothing to this one (a seedream id on fal, say).
  const fallback = buildByName(configured, { ...overrides, imageProvider: undefined, imageModel: undefined }, missingKeys);
  return fallback.provider ?? new MockImageProvider();
}
