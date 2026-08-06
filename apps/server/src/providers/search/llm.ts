import Anthropic from "@anthropic-ai/sdk";
import type { SearchProvider, SearchResult } from "../types.js";

const SEARCH_SYSTEM =
  "You are a research assistant for an infinite visual encyclopedia. Research the given topic using web search " +
  "and return a compact, factual summary suitable for grounding an infographic: concrete dates, prices, hours, " +
  "names, numbers, and other specifics that could be rendered as text on a page. No commentary, no markdown, " +
  "plain prose, 3-6 sentences.";

/**
 * Anthropic server-side web_search tool type ids, newest first. The provider tries each until
 * one actually produces a `web_search_tool_result` block — not merely until one is *accepted*:
 * a proxy can accept a tool type, run it through some other mechanism (observed: a
 * code-execution sandbox calling an internal web_search() helper), and silently fail without
 * ever throwing, leaving the model to answer from training knowledge alone.
 */
const WEB_SEARCH_TOOL_TYPES = ["web_search_20260209", "web_search_20250305"] as const;

export class LlmSearchProvider implements SearchProvider {
  readonly available = true;
  private readonly client: Anthropic;
  private readonly model: string;
  private workingToolType: (typeof WEB_SEARCH_TOOL_TYPES)[number] | null = null;
  private warnedNoWebSearch = false;

  constructor(apiKey: string, baseURL: string, model: string) {
    this.client = new Anthropic({ apiKey, baseURL });
    this.model = model;
  }

  async search(query: string): Promise<SearchResult | null> {
    const toolTypesToTry = this.workingToolType ? [this.workingToolType] : WEB_SEARCH_TOOL_TYPES;

    let lastMessage: Anthropic.Message | null = null;
    let lastToolType: (typeof WEB_SEARCH_TOOL_TYPES)[number] | null = null;

    for (const toolType of toolTypesToTry) {
      try {
        const message = await this.client.messages.create({
          model: this.model,
          max_tokens: 1024,
          system: SEARCH_SYSTEM,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- server tool type not yet in SDK's stable typings
          tools: [{ type: toolType, name: "web_search" } as any],
          messages: [{ role: "user", content: `Research: ${query}` }],
        });

        lastMessage = message;
        lastToolType = toolType;

        const gotRealResults = message.content.some((block) => block.type === "web_search_tool_result");
        if (gotRealResults) {
          this.workingToolType = toolType;
          return { summary: this.extractSummary(message) };
        }
        // Accepted but produced no real result block (soft failure) — fall through to the next tool type.
      } catch {
        // Rejected outright — fall through to the next tool type.
      }
    }

    // Nothing produced a verified web_search_tool_result. Degrade to whatever text the last
    // attempt returned (model-knowledge-only), and say so loudly — never silently accept this.
    this.logNoWebSearch(
      lastMessage
        ? `proxy accepted tool type "${lastToolType}" but never returned a web_search_tool_result block — summary is from model knowledge only.`
        : `proxy rejected the web_search tool (tried ${toolTypesToTry.join(", ")}).`,
    );
    if (!lastMessage) return null;
    const summary = this.extractSummary(lastMessage);
    return summary ? { summary, degraded: true } : null;
  }

  private extractSummary(message: Anthropic.Message): string {
    return message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
  }

  private logNoWebSearch(detail: string): void {
    if (this.warnedNoWebSearch) return;
    this.warnedNoWebSearch = true;
    // eslint-disable-next-line no-console
    console.warn(`[search/llm] web_search unavailable: ${detail}`);
  }
}
