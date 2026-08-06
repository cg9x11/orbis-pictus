import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOUSE_STYLE_PATH = path.resolve(__dirname, "../prompts/house-style.md");
const HOUSE_STYLE_SOURCE = fs.readFileSync(HOUSE_STYLE_PATH, "utf-8");

export type HouseStyleName = "felt" | "papercut" | "riso" | "pixel";
const STYLE_NAMES: HouseStyleName[] = ["felt", "papercut", "riso", "pixel"];

function anchor(name: string): string {
  return `<!-- house-style:${name} -->`;
}

/** Text between an anchor comment and the next one (or EOF), trimmed. */
function extractSection(name: string): string {
  const marker = anchor(name);
  const start = HOUSE_STYLE_SOURCE.indexOf(marker);
  if (start === -1) throw new Error(`house-style.md is missing anchor ${marker}`);
  const afterMarker = start + marker.length;
  const nextMarkerStart = HOUSE_STYLE_SOURCE.indexOf("<!-- house-style:", afterMarker);
  const end = nextMarkerStart === -1 ? HOUSE_STYLE_SOURCE.length : nextMarkerStart;
  return HOUSE_STYLE_SOURCE.slice(afterMarker, end).trim();
}

const LAYOUT_SECTION = extractSection("layout");
const STYLE_SECTIONS: Record<HouseStyleName, string> = Object.fromEntries(
  STYLE_NAMES.map((name) => [name, extractSection(name)]),
) as Record<HouseStyleName, string>;

export function isHouseStyleName(raw: string | undefined | null): raw is HouseStyleName {
  return (STYLE_NAMES as string[]).includes(raw ?? "");
}

/** The style used when a request doesn't name one — `HOUSE_STYLE` env, or felt (PLAN §2). */
export function getDefaultHouseStyleName(): HouseStyleName {
  const raw = process.env.HOUSE_STYLE;
  return isHouseStyleName(raw) ? raw : "felt";
}

/** Human label taken from the section's own "## Style: …" heading, so the picker can never drift
 *  out of sync with the prompt text it selects — there is one source of truth, house-style.md. */
function styleLabel(name: HouseStyleName): string {
  const heading = /^##\s*Style:\s*(.+)$/m.exec(STYLE_SECTIONS[name])?.[1]?.trim();
  const text = heading ?? name;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function listHouseStyles(): { name: HouseStyleName; label: string }[] {
  return STYLE_NAMES.map((name) => ({ name, label: styleLabel(name) }));
}

/**
 * Layout contract + one style block (PLAN §2 VISUAL IDENTITY) — the text appended verbatim to
 * every image prompt. An unknown or absent `style` falls back to the server default rather than
 * erroring: a bad value should render the house look, never break a generation.
 */
export function getHouseStyleBlock(style?: string): string {
  const name = isHouseStyleName(style) ? style : getDefaultHouseStyleName();
  return `${LAYOUT_SECTION}\n\n${STYLE_SECTIONS[name]}`;
}

/**
 * Appends the house style to a content-only prompt authored by the LLM (page-author.md /
 * edit-author.md write content only). Because the style text ends up inside the built prompt, the
 * prompt-hash image cache (PLAN §2.3 layer 3) keys on it automatically — switching style can never
 * serve back an image drawn in the previous one.
 */
export function buildImagePrompt(contentPrompt: string, style?: string): string {
  return `${contentPrompt}\n\n${getHouseStyleBlock(style)}`;
}
