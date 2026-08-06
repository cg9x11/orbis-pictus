import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { parseDataUrl } from "../../lib/dataUrl.js";
import type {
  AuthorEditInput,
  AuthorPromptInput,
  AuthorPromptOutput,
  DescribeTapOutput,
  LlmProvider,
  TitleImageOutput,
} from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const promptsDir = path.resolve(__dirname, "../../prompts");

const PAGE_AUTHOR_SYSTEM = fs.readFileSync(path.join(promptsDir, "page-author.md"), "utf-8");
const EDIT_AUTHOR_SYSTEM = fs.readFileSync(path.join(promptsDir, "edit-author.md"), "utf-8");
const TAP_SUBJECT_SYSTEM = fs.readFileSync(path.join(promptsDir, "tap-subject.md"), "utf-8");
const IMAGE_TITLE_SYSTEM = fs.readFileSync(path.join(promptsDir, "image-title.md"), "utf-8");

function imageContentBlock(dataUrl: string): Anthropic.ImageBlockParam {
  const { mimeType, base64 } = parseDataUrl(dataUrl);
  return {
    type: "image",
    source: { type: "base64", media_type: mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: base64 },
  };
}

/**
 * Extract a JSON object despite models wrapping it in ```json ... ``` fences, or (seen with web
 * search grounding enabled) adding commentary before/after the fenced block, despite the system
 * prompt saying "JSON only, no markdown fences, no commentary" in both cases.
 */
export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // not bare JSON — fall through
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]!.trim());
    } catch {
      // fenced content wasn't valid JSON either — fall through to brace-slicing
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }
  throw new Error(`Could not parse JSON from LLM response: ${trimmed.slice(0, 200)}`);
}

function textFromMessage(message: Anthropic.Message): string {
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  if (!text) throw new Error(`Anthropic response missing text content: ${JSON.stringify(message.content)}`);
  return text;
}

export class AnthropicLlmProvider implements LlmProvider {
  readonly modelId: string;
  private readonly tapModelId: string;
  private readonly client: Anthropic;

  constructor(apiKey: string, baseURL: string, promptAuthorModel: string, tapVlmModel: string) {
    this.client = new Anthropic({ apiKey, baseURL });
    this.modelId = promptAuthorModel;
    this.tapModelId = tapVlmModel;
  }

  async authorPrompt(input: AuthorPromptInput): Promise<AuthorPromptOutput> {
    const contextLines: string[] = [`Topic: ${input.topic}`];
    if (input.parentTitle) contextLines.push(`Parent page title: ${input.parentTitle}`);
    if (input.parentAuthoredPrompt) contextLines.push(`Parent page content prompt (for thematic continuity, not style): ${input.parentAuthoredPrompt}`);
    if (input.webSearchSummary) contextLines.push(`Web search summary: ${input.webSearchSummary}`);

    const message = await this.client.messages.create({
      model: this.modelId,
      max_tokens: 4096,
      system: PAGE_AUTHOR_SYSTEM,
      messages: [{ role: "user", content: contextLines.join("\n") }],
    });

    const result = parseJsonLoose(textFromMessage(message)) as { page_title: string; image_prompt: string };
    return { pageTitle: result.page_title, authoredPrompt: result.image_prompt };
  }

  async authorEdit(input: AuthorEditInput): Promise<AuthorPromptOutput> {
    const contextLines: string[] = [`Command: ${input.command}`];
    if (input.parentTitle) contextLines.push(`Parent page title: ${input.parentTitle}`);
    contextLines.push(`Parent page image prompt: ${input.parentAuthoredPrompt}`);
    if (input.webSearchSummary) contextLines.push(`Web search summary: ${input.webSearchSummary}`);

    const message = await this.client.messages.create({
      model: this.modelId,
      max_tokens: 4096,
      system: EDIT_AUTHOR_SYSTEM,
      messages: [{ role: "user", content: contextLines.join("\n") }],
    });

    const result = parseJsonLoose(textFromMessage(message)) as { page_title: string; image_prompt: string };
    return { pageTitle: result.page_title, authoredPrompt: result.image_prompt };
  }

  async describeTap(markedImageDataUrl: string): Promise<DescribeTapOutput> {
    const message = await this.client.messages.create({
      model: this.tapModelId,
      max_tokens: 256,
      system: TAP_SUBJECT_SYSTEM,
      messages: [
        {
          role: "user",
          content: [imageContentBlock(markedImageDataUrl), { type: "text", text: "What is under the marker?" }],
        },
      ],
    });

    const result = parseJsonLoose(textFromMessage(message)) as { subject: string };
    return { subject: result.subject };
  }

  async titleImage(imageDataUrl: string): Promise<TitleImageOutput> {
    const message = await this.client.messages.create({
      model: this.tapModelId,
      max_tokens: 256,
      system: IMAGE_TITLE_SYSTEM,
      messages: [
        {
          role: "user",
          content: [imageContentBlock(imageDataUrl), { type: "text", text: "Title this image." }],
        },
      ],
    });

    const result = parseJsonLoose(textFromMessage(message)) as { title: string; description: string };
    return { title: result.title, description: result.description };
  }
}
