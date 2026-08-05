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

function activeStyleName(): HouseStyleName {
  const raw = process.env.HOUSE_STYLE;
  return (STYLE_NAMES as string[]).includes(raw ?? "") ? (raw as HouseStyleName) : "felt";
}

/** Layout contract + the active style block (PLAN §2 VISUAL IDENTITY) — the text appended verbatim to every image prompt. */
export function getHouseStyleBlock(): string {
  return `${LAYOUT_SECTION}\n\n${STYLE_SECTIONS[activeStyleName()]}`;
}

/** Appends the house style to a content-only prompt authored by the LLM (page-author.md / edit-author.md write content only). */
export function buildImagePrompt(contentPrompt: string): string {
  return `${contentPrompt}\n\n${getHouseStyleBlock()}`;
}
