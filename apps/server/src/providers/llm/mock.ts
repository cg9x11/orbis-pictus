import type { AuthorPromptInput, AuthorPromptOutput, DescribeTapOutput, LlmProvider } from "../types.js";

/** Deterministic canned responses — no network calls. Used when GEMINI_API_KEY is absent. */
export class MockLlmProvider implements LlmProvider {
  readonly modelId = "mock-llm";

  async authorPrompt(input: AuthorPromptInput): Promise<AuthorPromptOutput> {
    const pageTitle = titleCase(input.topic);
    const parentNote = input.parentTitle ? ` Continuing from the parent page "${input.parentTitle}".` : "";
    const authoredPrompt =
      `An educational infographic titled "${pageTitle}".${parentNote} ` +
      `Clean modern vector illustration, warm palette, cream background. ` +
      `Layout: a bold title banner reading "${pageTitle}" at the top, ` +
      `four labeled panels below covering distinct facets of ${input.topic}, ` +
      `each with a short caption. Footer strip with one fact about ${input.topic}. [mock]`;
    return { pageTitle, authoredPrompt };
  }

  async describeTap(_markedImageDataUrl: string): Promise<DescribeTapOutput> {
    return { subject: "Mock Subject" };
  }
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w.length ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}
