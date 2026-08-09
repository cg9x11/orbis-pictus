import fs from "node:fs";
import path from "node:path";
import { PROMPTS_DIR } from "../../paths.js";
import { parseDataUrl } from "../../lib/dataUrl.js";
import { fetchWithRetry } from "../../lib/retry.js";
import { parseAuthorOutput, type RawAuthorOutput } from "./authorOutput.js";
import type {
  AuthorEditInput,
  AuthorPromptInput,
  AuthorPromptOutput,
  DescribeTapOutput,
  LlmProvider,
  MotionPromptOutput,
  TitleImageOutput,
} from "../types.js";

const PAGE_AUTHOR_SYSTEM = fs.readFileSync(path.join(PROMPTS_DIR, "page-author.md"), "utf-8");
const EDIT_AUTHOR_SYSTEM = fs.readFileSync(path.join(PROMPTS_DIR, "edit-author.md"), "utf-8");
const TAP_SUBJECT_SYSTEM = fs.readFileSync(path.join(PROMPTS_DIR, "tap-subject.md"), "utf-8");
const IMAGE_TITLE_SYSTEM = fs.readFileSync(path.join(PROMPTS_DIR, "image-title.md"), "utf-8");
const IDLE_MOTION_SYSTEM = fs.readFileSync(path.join(PROMPTS_DIR, "idle-motion.md"), "utf-8");
const MORPH_MOTION_SYSTEM = fs.readFileSync(path.join(PROMPTS_DIR, "morph-motion.md"), "utf-8");

interface GeminiPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
}

async function callGemini(apiKey: string, model: string, systemInstruction: string, parts: GeminiPart[]): Promise<unknown> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetchWithRetry(url, {
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
    ])) as RawAuthorOutput;

    return parseAuthorOutput(result);
  }

  async authorEdit(input: AuthorEditInput): Promise<AuthorPromptOutput> {
    const contextLines: string[] = [`Command: ${input.command}`];
    if (input.parentTitle) contextLines.push(`Parent page title: ${input.parentTitle}`);
    contextLines.push(`Parent page background prompt: ${input.parentAuthoredPrompt}`);
    contextLines.push(`Parent page labels (JSON): ${JSON.stringify(input.parentLabels)}`);
    contextLines.push(`Parent page footer: ${input.parentFooter}`);
    if (input.webSearchSummary) contextLines.push(`Web search summary: ${input.webSearchSummary}`);

    const result = (await callGemini(this.apiKey, this.modelId, EDIT_AUTHOR_SYSTEM, [
      { text: contextLines.join("\n") },
    ])) as RawAuthorOutput;

    return parseAuthorOutput(result);
  }

  async describeTap(markedImageDataUrl: string): Promise<DescribeTapOutput> {
    const { mimeType, base64 } = parseDataUrl(markedImageDataUrl);

    const result = (await callGemini(this.apiKey, this.modelId, TAP_SUBJECT_SYSTEM, [
      { inline_data: { mime_type: mimeType, data: base64 } },
    ])) as { subject: string };

    return { subject: result.subject };
  }

  async titleImage(imageDataUrl: string): Promise<TitleImageOutput> {
    const { mimeType, base64 } = parseDataUrl(imageDataUrl);

    const result = (await callGemini(this.apiKey, this.modelId, IMAGE_TITLE_SYSTEM, [
      { inline_data: { mime_type: mimeType, data: base64 } },
    ])) as { title: string; description: string };

    return { title: result.title, description: result.description };
  }

  async describeIdleMotion(imageDataUrl: string): Promise<MotionPromptOutput> {
    const { mimeType, base64 } = parseDataUrl(imageDataUrl);

    const result = (await callGemini(this.apiKey, this.modelId, IDLE_MOTION_SYSTEM, [
      { inline_data: { mime_type: mimeType, data: base64 } },
    ])) as { motion_prompt: string };

    return { motionPrompt: result.motion_prompt };
  }

  async describeMorphMotion(firstFrameDataUrl: string, lastFrameDataUrl: string): Promise<MotionPromptOutput> {
    const first = parseDataUrl(firstFrameDataUrl);
    const last = parseDataUrl(lastFrameDataUrl);

    const result = (await callGemini(this.apiKey, this.modelId, MORPH_MOTION_SYSTEM, [
      { text: "FIRST frame (page being left):" },
      { inline_data: { mime_type: first.mimeType, data: first.base64 } },
      { text: "SECOND frame (page being arrived at):" },
      { inline_data: { mime_type: last.mimeType, data: last.base64 } },
      { text: "Describe the transition from the first image into the second." },
    ])) as { motion_prompt: string };

    return { motionPrompt: result.motion_prompt };
  }
}
