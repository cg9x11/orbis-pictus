import type { AspectRatio } from "@orbis/shared";
import { UnknownModelError, type ImageGenInput, type ImageGenResult, type ImageProvider } from "../types.js";
import { fetchWithRetry } from "../../lib/retry.js";
import { strConfig } from "../../config/index.js";
import type { ImageProviderFactory } from "./registry.js";

const IMAGE_SIZE_BY_ASPECT: Record<AspectRatio, string> = {
  "16:9": "landscape_16_9",
  "3:4": "portrait_4_3",
  "1:1": "square_hd",
};

export class FalImageProvider implements ImageProvider {
  readonly modelId: string;
  readonly providerId = "fal";
  private readonly apiKey: string;

  constructor(apiKey: string, model = "fal-ai/flux/schnell") {
    this.apiKey = apiKey;
    this.modelId = model;
  }

  async generate(input: ImageGenInput): Promise<ImageGenResult> {
    const res = await fetchWithRetry(`https://fal.run/${this.modelId}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        prompt: input.prompt,
        image_size: IMAGE_SIZE_BY_ASPECT[input.aspectRatio],
        num_images: 1,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      // The model id IS the request path on fal, so a 404 means "no such application".
      // Verified empirically 2026-08-08: an unknown model answers 404 with
      // `{"detail": "Application '<id>' not found"}` - note it says "Application", never "model",
      // so matching on the word "model" would miss this entirely. The status is the reliable signal.
      if (res.status === 404) {
        throw new UnknownModelError(`fal.ai does not recognise image model "${this.modelId}". ${body}`);
      }
      throw new Error(`fal.ai request failed (${res.status}): ${body}`);
    }
    const json = (await res.json()) as {
      images?: { url: string; content_type?: string }[];
    };
    const image = json.images?.[0];
    if (!image) throw new Error(`fal.ai response missing images: ${JSON.stringify(json)}`);

    const imgRes = await fetchWithRetry(image.url, {});
    if (!imgRes.ok) throw new Error(`Failed to download generated image from ${image.url}`);
    const bytes = Buffer.from(await imgRes.arrayBuffer());
    const contentType = image.content_type ?? imgRes.headers.get("content-type") ?? "image/jpeg";

    return { bytes, contentType };
  }
}

export const falImageFactory: ImageProviderFactory = {
  id: "fal",
  build: (ctx) => {
    const apiKey = process.env.FAL_KEY;
    if (!apiKey) {
      ctx.reportMissing("FAL_KEY");
      return null;
    }
    return new FalImageProvider(
      apiKey,
      ctx.overrides.imageModel ?? strConfig("IMAGE_MODEL", (c) => c.image?.fal?.model, "fal-ai/flux/schnell"),
    );
  },
};
