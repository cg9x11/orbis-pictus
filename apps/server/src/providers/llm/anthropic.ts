import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import type { AuthorPromptInput, AuthorPromptOutput, DescribeTapOutput, LlmProvider } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const promptsDir = path.resolve(__dirname, "../../prompts");

const PAGE_AUTHOR_SYSTEM = fs.readFileSync(path.join(promptsDir, "page-author.md"), "utf-8");
const TAP_SUBJECT_SYSTEM = fs.readFileSync(path.join(promptsDir, "tap-subject.md"), "utf-8");

/** Strip ```json ... ``` / ``` ... ``` fences some models wrap JSON in despite instructions not to. */
function parseJsonLoose(text: string): unknown {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text.trim());
  const body = fenced ? fenced[1]! : text;
  return JSON.parse(body);
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
    if (input.parentAuthoredPrompt) contextLines.push(`Parent page image prompt (match this style): ${input.parentAuthoredPrompt}`);
    if (input.webSearchSummary) contextLines.push(`Web search summary: ${input.webSearchSummary}`);

    const message = await this.client.messages.create({
      model: this.modelId,
      max_tokens: 2048,
      system: PAGE_AUTHOR_SYSTEM,
      messages: [{ role: "user", content: contextLines.join("\n") }],
    });

    const result = parseJsonLoose(textFromMessage(message)) as { page_title: string; image_prompt: string };
    return { pageTitle: result.page_title, authoredPrompt: result.image_prompt };
  }

  async describeTap(markedImageDataUrl: string): Promise<DescribeTapOutput> {
    const match = /^data:(image\/\w+);base64,(.*)$/.exec(markedImageDataUrl);
    if (!match) throw new Error("describeTap: expected a data: URL");
    const [, mimeType, data] = match;

    const message = await this.client.messages.create({
      model: this.tapModelId,
      max_tokens: 256,
      system: TAP_SUBJECT_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: data! },
            },
            { type: "text", text: "What is under the marker?" },
          ],
        },
      ],
    });

    const result = parseJsonLoose(textFromMessage(message)) as { subject: string };
    return { subject: result.subject };
  }
}
