import crypto from "node:crypto";
import type { AspectRatio } from "@orbis/shared";

/** SHA-256 of (authored_prompt, aspect_ratio, image model, provider). */
export function computePromptHash(
  authoredPrompt: string,
  aspectRatio: AspectRatio,
  imageModel: string,
  providerId: string,
): string {
  return crypto
    .createHash("sha256")
    .update([authoredPrompt, aspectRatio, imageModel, providerId].join(" "))
    .digest("hex");
}
