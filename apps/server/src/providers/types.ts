import type { AspectRatio } from "@flipbook/shared";

// --- LLM provider: prompt author + tap VLM (PLAN §2.2 [A]/[B]) ---
export interface AuthorPromptInput {
  /** The query text (search mode) or the tapped subject name (tap mode). */
  topic: string;
  parentAuthoredPrompt?: string;
  parentTitle?: string;
  webSearchSummary?: string;
}

export interface AuthorPromptOutput {
  pageTitle: string;
  authoredPrompt: string;
}

export interface DescribeTapOutput {
  subject: string;
}

export interface LlmProvider {
  readonly modelId: string;
  authorPrompt(input: AuthorPromptInput): Promise<AuthorPromptOutput>;
  /** markedImageDataUrl: the current page image with the red tap marker drawn on it. */
  describeTap(markedImageDataUrl: string): Promise<DescribeTapOutput>;
}

// --- Image provider (PLAN §2.2 [C]/[D]) ---
export interface ImageGenInput {
  prompt: string;
  aspectRatio: AspectRatio;
  /** Current page image (data: URL) to use as an editing/reference input. Providers without image-input support may ignore it. */
  referenceImageDataUrl?: string;
}

export interface ImageGenResult {
  bytes: Buffer;
  contentType: string;
}

export interface ImageProvider {
  readonly modelId: string;
  generate(input: ImageGenInput): Promise<ImageGenResult>;
}

// --- Web search provider (stub interface, `none` only in Phase 1) ---
export interface SearchResult {
  summary: string;
}

export interface SearchProvider {
  search(query: string): Promise<SearchResult | null>;
}
