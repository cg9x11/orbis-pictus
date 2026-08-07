import type { ImageProvider } from "../types.js";
import { strConfig } from "../../config/index.js";
import { MockImageProvider } from "./mock.js";
import { falImageFactory } from "./fal.js";
import { arkImageFactory } from "./ark.js";
import { geminiImageFactory } from "./gemini.js";
import { openaiImageFactory } from "./openai.js";
import type { ImageProviderFactory } from "./registry.js";

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

/** Builds the configured image provider, falling back to the mock when the name is unknown or the
 *  selected provider is missing its key (each factory reports what's missing via `missingKeys`). */
export function buildImageProvider(missingKeys: string[]): ImageProvider {
  const active = strConfig("IMAGE_PROVIDER", (c) => c.image?.provider, "fal");
  if (active === "mock") return new MockImageProvider();

  const factory = IMAGE_PROVIDER_FACTORIES.find((f) => f.id === active);
  if (!factory) {
    missingKeys.push(`IMAGE_PROVIDER="${active}" is not a known image provider (using mock)`);
    return new MockImageProvider();
  }
  return factory.build({ reportMissing: (label) => missingKeys.push(label) }) ?? new MockImageProvider();
}
