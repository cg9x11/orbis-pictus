import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

interface GeminiPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
}

async function callGemini(apiKey: string, model: string, systemInstruction: string, parts: GeminiPart[]): Promise<unknown> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini request failed (${res.status}): ${body}`);
  }
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error(`Gemini response missing text: ${JSON.stringify(json)}`);
  return JSON.parse(text);
}

export class GeminiLlmProvider implements LlmProvider {
  readonly modelId: string;
  private readonly apiKey: string;

  constructor(apiKey: string, model = "gemini-2.0-flash") {
    this.apiKey = apiKey;
    this.modelId = model;
  }

  async authorPrompt(input: AuthorPromptInput): Promise<AuthorPromptOutput> {
    const contextLines: string[] = [`Topic: ${input.topic}`];
    if (input.parentTitle) contextLines.push(`Parent page title: ${input.parentTitle}`);
    if (input.parentAuthoredPrompt) contextLines.push(`Parent page content prompt (for thematic continuity, not style): ${input.parentAuthoredPrompt}`);
    if (input.webSearchSummary) contextLines.push(`Web search summary: ${input.webSearchSummary}`);

    const result = (await callGemini(this.apiKey, this.modelId, PAGE_AUTHOR_SYSTEM, [
      { text: contextLines.join("\n") },
    ])) as { page_title: string; image_prompt: string };

    return { pageTitle: result.page_title, authoredPrompt: result.image_prompt };
  }

  async authorEdit(input: AuthorEditInput): Promise<AuthorPromptOutput> {
    const contextLines: string[] = [`Command: ${input.command}`];
    if (input.parentTitle) contextLines.push(`Parent page title: ${input.parentTitle}`);
    contextLines.push(`Parent page image prompt: ${input.parentAuthoredPrompt}`);
    if (input.webSearchSummary) contextLines.push(`Web search summary: ${input.webSearchSummary}`);

    const result = (await callGemini(this.apiKey, this.modelId, EDIT_AUTHOR_SYSTEM, [
      { text: contextLines.join("\n") },
    ])) as { page_title: string; image_prompt: string };

    return { pageTitle: result.page_title, authoredPrompt: result.image_prompt };
  }

  async describeTap(markedImageDataUrl: string): Promise<DescribeTapOutput> {
    const match = /^data:(image\/\w+);base64,(.*)$/.exec(markedImageDataUrl);
    if (!match) throw new Error("describeTap: expected a data: URL");
    const [, mimeType, data] = match;

    const result = (await callGemini(this.apiKey, this.modelId, TAP_SUBJECT_SYSTEM, [
      { inline_data: { mime_type: mimeType!, data: data! } },
    ])) as { subject: string };

    return { subject: result.subject };
  }

  async titleImage(imageDataUrl: string): Promise<TitleImageOutput> {
    const match = /^data:(image\/\w+);base64,(.*)$/.exec(imageDataUrl);
    if (!match) throw new Error("titleImage: expected a data: URL");
    const [, mimeType, data] = match;

    const result = (await callGemini(this.apiKey, this.modelId, IMAGE_TITLE_SYSTEM, [
      { inline_data: { mime_type: mimeType!, data: data! } },
    ])) as { title: string; description: string };

    return { title: result.title, description: result.description };
  }
}
