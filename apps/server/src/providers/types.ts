import type { AspectRatio } from "@flipbook/shared";

/** Thrown when a provider call fails specifically because of quota/rate-limit exhaustion, so
 *  callers (routes/generate.ts) can flag it on the SSE `error` event's `code` field for the
 *  client to react to directly, instead of pattern-matching the error message text. */
export class QuotaExhaustedError extends Error {}

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

export interface AuthorEditInput {
  /** The user's typed command, e.g. "make it night time". */
  command: string;
  /** The image prompt that produced the page being edited — the edit rewrites this. */
  parentAuthoredPrompt: string;
  parentTitle?: string;
  webSearchSummary?: string;
}

export interface DescribeTapOutput {
  subject: string;
}

export interface MotionPromptOutput {
  /** A short, scene-specific motion prompt for the video model (see idle-motion.md / morph-motion.md). */
  motionPrompt: string;
}

export interface TitleImageOutput {
  title: string;
  /** Short description usable as authored_prompt for style continuity on future child pages. */
  description: string;
}

export interface LlmProvider {
  readonly modelId: string;
  authorPrompt(input: AuthorPromptInput): Promise<AuthorPromptOutput>;
  /** Rewrites a parent page's authored_prompt per an edit command (PLAN §4 edit-author.md). */
  authorEdit(input: AuthorEditInput): Promise<AuthorPromptOutput>;
  /** markedImageDataUrl: the current page image with the red tap marker drawn on it. */
  describeTap(markedImageDataUrl: string): Promise<DescribeTapOutput>;
  /** imageDataUrl: a user-uploaded photo with no marker. */
  titleImage(imageDataUrl: string): Promise<TitleImageOutput>;
  /** Looks at a page's own rendered image and returns a short idle-loop motion prompt tailored to
   *  what THIS image actually contains (see idle-motion.md). The static-camera / unchanged-text
   *  guardrails live in the prompt; the background clip pipeline falls back to a generic prompt if
   *  this throws (PLAN §3 Phase 5). */
  describeIdleMotion(imageDataUrl: string): Promise<MotionPromptOutput>;
  /** Looks at a page-transition's two frames (parent -> child) and returns a short morph prompt
   *  describing how the first repaints into the second (see morph-motion.md). */
  describeMorphMotion(firstFrameDataUrl: string, lastFrameDataUrl: string): Promise<MotionPromptOutput>;
}

// --- Image provider (PLAN §2.2 [C]/[D]) ---
export interface ImageGenInput {
  prompt: string;
  aspectRatio: AspectRatio;
  /** Current page image (data: URL) to use as an editing/reference input. Providers without image-input support may ignore it. */
  referenceImageDataUrl?: string;
}

/** Token usage a provider reported for one image generation, when it returns one (Gemini's
 *  `usageMetadata`, OpenAI's `usage`). Absent for providers that bill per-image and report no tokens
 *  (fal) or don't surface it (ark, mock). Used only for the optional DEBUG_IMAGE_PROMPT cost log. */
export interface ImageUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ImageGenResult {
  bytes: Buffer;
  contentType: string;
  /** Optional token usage for cost estimation/logging; not every provider reports it. */
  usage?: ImageUsage;
}

export interface ImageProvider {
  readonly modelId: string;
  /** Short provider identifier (e.g. "ark", "fal", "mock") — part of the prompt-hash cache key (PLAN §2.3 layer 3), distinct from modelId so a provider swap invalidates the cache even if a model id string happens to collide. */
  readonly providerId: string;
  generate(input: ImageGenInput): Promise<ImageGenResult>;
}

// --- Video provider (PLAN §3 Phase 5, idle-loop background animation) ---
export interface VideoGenInput {
  /** Content-only motion prompt (PLAN §2 VISUAL IDENTITY content/style split applies here too — no house-style words baked in by callers). */
  prompt: string;
  aspectRatio: AspectRatio;
  /** First frame — for the idle loop this is the page's own rendered image (data: URL). */
  firstFrameDataUrl: string;
  /** Last frame — reserved for the optional Phase 5 transition-morph task; providers without first-last-frame support may ignore it. */
  lastFrameDataUrl?: string;
  durationSeconds: number;
  /** Dev default 480p (PLAN §3 Phase 5: "never 1080p in this session"). */
  resolution: "480p" | "720p" | "1080p";
  /** Overrides the provider's configured model for this one call. Used so morphs (which need
   *  first-last-frame `flf2v` support) can run on a different model than the idle loop (single-frame
   *  `i2v`) — e.g. an idle loop on a fast i2v-only model while morph uses a flf2v-capable one. When
   *  absent, the provider uses its own configured model. */
  modelOverride?: string;
}

export interface VideoGenResult {
  bytes: Buffer;
  contentType: string;
}

export interface VideoProvider {
  readonly modelId: string;
  /** Short provider identifier (e.g. "ark", "mock"), mirrors ImageProvider.providerId. */
  readonly providerId: string;
  generate(input: VideoGenInput): Promise<VideoGenResult>;
}

// --- Web search provider (stub interface, `none` only in Phase 1) ---
export interface SearchResult {
  summary: string;
  /** True when `summary` didn't actually come from a web search — the provider fell back to
   *  model-knowledge-only text after every search-tool attempt failed or silently produced no
   *  results (see providers/search/llm.ts). Omitted (not just false) when the search genuinely
   *  ran, so a caller can tell "known good" from "never checked" from "checked and degraded". */
  degraded?: boolean;
}

export interface SearchProvider {
  /** Whether this provider can actually perform a search (vs. the no-key `none` stub). */
  readonly available: boolean;
  search(query: string): Promise<SearchResult | null>;
}
