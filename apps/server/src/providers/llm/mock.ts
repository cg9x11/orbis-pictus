import type { PageLabel } from "@orbis/shared";
import type {
  AuthorEditInput,
  AuthorPromptInput,
  AuthorPromptOutput,
  DescribeTapOutput,
  LlmProvider,
  MotionPromptOutput,
  TitleImageOutput,
} from "../types.js";

/** Deterministic canned responses — no network calls. Used when GEMINI_API_KEY is absent. */
export class MockLlmProvider implements LlmProvider {
  readonly modelId = "mock-llm";

  async authorPrompt(input: AuthorPromptInput): Promise<AuthorPromptOutput> {
    const pageTitle = titleCase(input.topic);
    const parentNote = input.parentTitle ? ` Continuing from the parent page "${input.parentTitle}".` : "";
    const authoredPrompt =
      `A clean scene with no text, illustrating ${input.topic}.${parentNote} ` +
      `Layout: four distinct facets of ${input.topic} arranged across the scene. [mock]`;
    const labels: PageLabel[] = [0, 1, 2, 3].map((i) => ({
      text: `${pageTitle} facet ${i + 1}`,
      description: "",
      subject: `facet ${i + 1} of ${input.topic}`,
      x: 0.2 + i * 0.2,
      y: 0.5,
    }));
    return { pageTitle, authoredPrompt, labels, footer: `A short fact about ${input.topic}. [mock]` };
  }

  async authorEdit(input: AuthorEditInput): Promise<AuthorPromptOutput> {
    const pageTitle = input.parentTitle ?? "Edited Page";
    const authoredPrompt = `${input.parentAuthoredPrompt} [edited: ${input.command}] [mock]`;
    return { pageTitle, authoredPrompt, labels: input.parentLabels, footer: input.parentFooter };
  }

  async describeTap(_markedImageDataUrl: string): Promise<DescribeTapOutput> {
    return { subject: "Mock Subject" };
  }

  async titleImage(_imageDataUrl: string): Promise<TitleImageOutput> {
    return { title: "Uploaded Photo", description: "A user-uploaded photograph. [mock]" };
  }

  async describeIdleMotion(_imageDataUrl: string): Promise<MotionPromptOutput> {
    return { motionPrompt: "Subtle ambient looping motion; static camera. [mock]" };
  }

  async describeMorphMotion(_firstFrameDataUrl: string, _lastFrameDataUrl: string): Promise<MotionPromptOutput> {
    return { motionPrompt: "Smooth transition from the first page into the second; static camera. [mock]" };
  }
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w.length ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}
