import type { AspectRatio } from "@flipbook/shared";
import type { ImageGenInput, ImageGenResult, ImageProvider } from "../types.js";

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
    const res = await fetch(`https://fal.run/${this.modelId}`, {
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
      throw new Error(`fal.ai request failed (${res.status}): ${body}`);
    }
    const json = (await res.json()) as {
      images?: { url: string; content_type?: string }[];
    };
    const image = json.images?.[0];
    if (!image) throw new Error(`fal.ai response missing images: ${JSON.stringify(json)}`);

    const imgRes = await fetch(image.url);
    if (!imgRes.ok) throw new Error(`Failed to download generated image from ${image.url}`);
    const bytes = Buffer.from(await imgRes.arrayBuffer());
    const contentType = image.content_type ?? imgRes.headers.get("content-type") ?? "image/jpeg";

    return { bytes, contentType };
  }
}
