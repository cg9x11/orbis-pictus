import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strConfig } from "../config/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOUSE_STYLE_PATH = path.resolve(__dirname, "../prompts/house-style.md");
const HOUSE_STYLE_SOURCE = fs.readFileSync(HOUSE_STYLE_PATH, "utf-8");

export type HouseStyleName = "felt" | "papercut" | "riso" | "pixel" | "editorial";
const STYLE_NAMES: HouseStyleName[] = ["felt", "papercut", "riso", "pixel", "editorial"];

export type CompositionName = "flat" | "isometric" | "diorama";
const COMPOSITION_NAMES: CompositionName[] = ["flat", "isometric", "diorama"];

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
const COMPOSITION_SECTIONS: Record<CompositionName, string> = Object.fromEntries(
  COMPOSITION_NAMES.map((name) => [name, extractSection(`composition-${name}`)]),
) as Record<CompositionName, string>;

export function isHouseStyleName(raw: string | undefined | null): raw is HouseStyleName {
  return (STYLE_NAMES as string[]).includes(raw ?? "");
}

export function isCompositionName(raw: string | undefined | null): raw is CompositionName {
  return (COMPOSITION_NAMES as string[]).includes(raw ?? "");
}

/** The style used when a request doesn't name one — `HOUSE_STYLE` env / `houseStyle` in config.yml,
 *  or felt (PLAN §2). */
export function getDefaultHouseStyleName(): HouseStyleName {
  const raw = strConfig("HOUSE_STYLE", (c) => c.houseStyle, "felt");
  return isHouseStyleName(raw) ? raw : "felt";
}

/** The composition used when a request doesn't name one — `COMPOSITION` env / `composition` in
 *  config.yml, or diorama (the app's original look, kept as the default so existing behaviour is
 *  unchanged). */
export function getDefaultCompositionName(): CompositionName {
  const raw = strConfig("COMPOSITION", (c) => c.composition, "diorama");
  return isCompositionName(raw) ? raw : "diorama";
}

/** Human label taken from a section's own "## <Keyword>: …" heading, so a picker can never drift
 *  out of sync with the prompt text it selects — there is one source of truth, house-style.md. */
function headingLabel(section: string, keyword: string, fallback: string): string {
  const heading = new RegExp(`^##\\s*${keyword}:\\s*(.+)$`, "m").exec(section)?.[1]?.trim();
  const text = heading ?? fallback;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function listHouseStyles(): { name: HouseStyleName; label: string }[] {
  return STYLE_NAMES.map((name) => ({ name, label: headingLabel(STYLE_SECTIONS[name], "Style", name) }));
}

export function listCompositions(): { name: CompositionName; label: string }[] {
  return COMPOSITION_NAMES.map((name) => ({ name, label: headingLabel(COMPOSITION_SECTIONS[name], "Composition", name) }));
}

/**
 * Layout furniture + one composition block + one style block (PLAN §2 VISUAL IDENTITY) — the text
 * wrapped into every image prompt. An unknown or absent `style`/`composition` falls back to the
 * server default rather than erroring: a bad value should render the house look, never break a
 * generation.
 */
export function getHouseStyleBlock(style?: string, composition?: string): string {
  const styleName = isHouseStyleName(style) ? style : getDefaultHouseStyleName();
  const compName = isCompositionName(composition) ? composition : getDefaultCompositionName();
  return `${LAYOUT_SECTION}\n\n${COMPOSITION_SECTIONS[compName]}\n\n${STYLE_SECTIONS[styleName]}`;
}

export interface BuildImagePromptOptions {
  /** Whether a reference image is passed to the image provider alongside this prompt, and how to
   *  treat it. "reuse" (tap/edit) keeps the reference's scene as the base for continuity; "none"
   *  (search/root) authors a fresh page. Search never carries a reference image, so it is "none". */
  reference?: "none" | "reuse";
  /** Which composition block (flat / diorama) to include. Falls back to the server default. */
  composition?: string;
}

/** Task framing, sent first. Adopts flipbook.page's proven prompt order (framing -> style ->
 *  quality -> `Content:`), which lands markedly better on modern image models (Gemini / GPT Image /
 *  nano-banana) than appending the style after the content did. Model-agnostic: it states what to
 *  make and that the page's own text is part of the artwork, nothing style-specific. */
const FRAMING =
  "You can generate a new visual article expanding on the chosen topic. The result is one single, " +
  "self-contained page: a highly detailed, beautifully composed illustration of the scene described " +
  "below, with its title, callout labels and footer caption drawn as an integral part of the artwork.";

/** Appended to FRAMING only when a reference image accompanies the request (tap/edit), so continuity
 *  is asked for explicitly — the opposite of flipbook.page's "entirely new composition", because our
 *  tap/edit flows deliberately keep the parent scene. */
const REFERENCE_REUSE =
  " A reference image is provided: keep its overall scene, layout and rendering as the base, and apply " +
  "the content described below on top of it so the result reads as the same place.";

/** Quality / integration directives, sent just before the content — flipbook.page's closer, which
 *  measurably lifts composition and legibility. Positive phrasing replaces the old Seedream-era
 *  defensive text-locking. */
const QUALITY =
  "Make every element beautiful, well-organized, clearly legible and native to the medium, integrated " +
  "into one coherent picture rather than pasted on top. Render all lettering crisply, spelled exactly " +
  "as written.";

/**
 * Wraps a content-only prompt (authored by page-author.md / edit-author.md) in the house style and
 * framing to form the full image prompt. Order is framing -> house style -> quality -> `Content: …`.
 * Because the style text ends up inside the built prompt, the prompt-hash image cache (PLAN §2.3
 * layer 3) keys on it automatically — switching style can never serve back an image drawn in the
 * previous one.
 */
export function buildImagePrompt(contentPrompt: string, style?: string, opts?: BuildImagePromptOptions): string {
  const framing = opts?.reference === "reuse" ? FRAMING + REFERENCE_REUSE : FRAMING;
  return `${framing}\n\n${getHouseStyleBlock(style, opts?.composition)}\n\n${QUALITY}\n\nContent: ${contentPrompt}`;
}
