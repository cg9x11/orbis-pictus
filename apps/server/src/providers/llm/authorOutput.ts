import { sanitizePageLabels } from "@orbis/shared";
import type { AuthorPromptOutput } from "../types.js";

/** The raw JSON shape both page-author.md and edit-author.md ask the model for. */
export interface RawAuthorOutput {
  page_title: string;
  background_prompt: string;
  labels?: unknown;
  footer?: string;
}

/** Parses a provider's raw JSON response into the shared AuthorPromptOutput shape. Coordinate
 *  clamping and per-entry dropping live in the shared `sanitizePageLabels`, so the write path here
 *  and the storage read path (storage/nodes.ts) validate labels by exactly the same rules. */
export function parseAuthorOutput(raw: RawAuthorOutput): AuthorPromptOutput {
  return {
    pageTitle: raw.page_title,
    authoredPrompt: raw.background_prompt,
    labels: sanitizePageLabels(raw.labels),
    footer: raw.footer ?? "",
  };
}
