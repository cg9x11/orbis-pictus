import { sanitizePageLabels } from "@orbis/shared";
import type { AuthorPromptOutput } from "../types.js";

/** The raw JSON shape both page-author.md and edit-author.md ask the model for. Every field is
 *  optional at this boundary: a model that answers with a stale contract (the old `image_prompt`
 *  key) or omits a field must degrade to a default, not crash the whole generation on a NOT NULL
 *  column. */
export interface RawAuthorOutput {
  page_title?: string;
  background_prompt?: string;
  /** Legacy key from the pre-layered contract. Accepted only as a fallback for background_prompt. */
  image_prompt?: string;
  labels?: unknown;
  footer?: string;
}

/** Parses a provider's raw JSON response into the shared AuthorPromptOutput shape. Coordinate
 *  clamping and per-entry dropping live in the shared `sanitizePageLabels`, so the write path here
 *  and the storage read path (storage/nodes.ts) validate labels by exactly the same rules. */
export function parseAuthorOutput(raw: RawAuthorOutput): AuthorPromptOutput {
  return {
    pageTitle: raw.page_title ?? "",
    // Fall back to the legacy image_prompt key, then to "", so a stale-contract or partial response
    // degrades (like labels/footer) instead of binding undefined to a NOT NULL column and throwing.
    authoredPrompt: raw.background_prompt ?? raw.image_prompt ?? "",
    labels: sanitizePageLabels(raw.labels),
    footer: raw.footer ?? "",
  };
}
