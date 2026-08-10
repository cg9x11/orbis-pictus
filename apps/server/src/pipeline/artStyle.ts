import fs from "node:fs";
import path from "node:path";
import { AUTO_COMPOSITION } from "@orbis/shared";
import { PROMPTS_DIR } from "../paths.js";
import { strConfig } from "../config/index.js";

const ART_STYLE_PATH = path.join(PROMPTS_DIR, "art-style.md");

export type ArtStyleName = "felt" | "papercut" | "riso" | "pixel" | "editorial" | "tiltshift";
const STYLE_NAMES: ArtStyleName[] = ["felt", "papercut", "riso", "pixel", "editorial", "tiltshift"];

export type CompositionName = "flat" | "isometric" | "diorama";
const COMPOSITION_NAMES: CompositionName[] = ["flat", "isometric", "diorama"];

/** Every `<!-- art-style:NAME -->` section keyed by its NAME, each trimmed. NAME is a bare section
 *  ("layout", "felt", "composition-flat") or a per-provider variant ("tiltshift@gemini"). One pass
 *  over the file, so a section runs from its own anchor up to whichever anchor comes next. */
function extractAllSections(source: string): Map<string, string> {
  const anchors = [...source.matchAll(/<!-- art-style:([a-z0-9@-]+) -->/g)];
  const out = new Map<string, string>();
  anchors.forEach((m, i) => {
    const name = m[1];
    const full = m[0];
    if (name === undefined || full === undefined || m.index === undefined) return;
    const start = m.index + full.length;
    const end = anchors[i + 1]?.index ?? source.length;
    out.set(name, source.slice(start, end).trim());
  });
  return out;
}

function required(all: Map<string, string>, name: string): string {
  const text = all.get(name);
  if (text === undefined) throw new Error(`art-style.md is missing anchor <!-- art-style:${name} -->`);
  return text;
}

interface ParsedArtStyle {
  layout: string;
  /** Base, provider-agnostic text for every style. */
  styles: Record<ArtStyleName, string>;
  /** Per-style, per-provider overrides. `styleVariants.tiltshift.gemini` wins over `styles.tiltshift`
   *  when the page is drawn by the gemini provider; a provider with no entry uses the base text. */
  styleVariants: Record<ArtStyleName, Record<string, string>>;
  compositions: Record<CompositionName, string>;
}

function parseArtStyle(source: string): ParsedArtStyle {
  const all = extractAllSections(source);
  const styleVariants = Object.fromEntries(STYLE_NAMES.map((n) => [n, {} as Record<string, string>])) as Record<
    ArtStyleName,
    Record<string, string>
  >;
  for (const [key, text] of all) {
    const at = key.indexOf("@");
    if (at === -1) continue;
    const base = key.slice(0, at);
    if (isArtStyleName(base)) styleVariants[base][key.slice(at + 1)] = text;
  }
  return {
    layout: required(all, "layout"),
    styles: Object.fromEntries(STYLE_NAMES.map((n) => [n, required(all, n)])) as Record<ArtStyleName, string>,
    styleVariants,
    compositions: Object.fromEntries(
      COMPOSITION_NAMES.map((n) => [n, required(all, `composition-${n}`)]),
    ) as Record<CompositionName, string>,
  };
}

// Hot-reload the prompt file when it changes on disk, so tuning art-style.md takes effect with no
// server restart (dev iteration; the md isn't imported, so `tsx watch` won't restart on its edits).
// Stat at most once per second — building a prompt reads a few sections, so this costs one stat.
let cached: ParsedArtStyle | undefined;
let cachedMtimeMs = 0;
let lastStatMs = 0;
const STAT_THROTTLE_MS = 1000;

function sections(): ParsedArtStyle {
  const now = Date.now();
  if (cached !== undefined && now - lastStatMs >= STAT_THROTTLE_MS) {
    lastStatMs = now;
    if (fs.statSync(ART_STYLE_PATH).mtimeMs !== cachedMtimeMs) cached = undefined;
  }
  if (cached === undefined) {
    lastStatMs = now;
    cachedMtimeMs = fs.statSync(ART_STYLE_PATH).mtimeMs;
    cached = parseArtStyle(fs.readFileSync(ART_STYLE_PATH, "utf-8"));
  }
  return cached;
}

export function isArtStyleName(raw: string | undefined | null): raw is ArtStyleName {
  return (STYLE_NAMES as string[]).includes(raw ?? "");
}

export function isCompositionName(raw: string | undefined | null): raw is CompositionName {
  return (COMPOSITION_NAMES as string[]).includes(raw ?? "");
}

/** The style used when a request doesn't name one — `ART_STYLE` env / `artStyle` in config.yml,
 *  or felt. */
export function getDefaultArtStyleName(): ArtStyleName {
  const raw = strConfig("ART_STYLE", (c) => c.artStyle, "felt");
  return isArtStyleName(raw) ? raw : "felt";
}

/** The composition used when a request doesn't name one — `COMPOSITION` env / `composition` in
 *  config.yml, or diorama (the app's original look, kept as the default so existing behaviour is
 *  unchanged). */
export function getDefaultCompositionName(): CompositionName {
  const raw = strConfig("COMPOSITION", (c) => c.composition, "diorama");
  return isCompositionName(raw) ? raw : "diorama";
}

/** The View the settings panel starts on: the operator's `COMPOSITION` (env / config.yml) when set,
 *  otherwise "auto". Unlike getDefaultCompositionName — the concrete server-side FALLBACK, which is
 *  always a real composition — this may be the "auto" sentinel and is the value the client sends
 *  back. So setting `COMPOSITION=flat` makes the UI start on Flat again, not silently on Auto. */
export function getConfiguredView(): string {
  return strConfig("COMPOSITION", (c) => c.composition, AUTO_COMPOSITION);
}

/** The style a request will actually be drawn in: the one it asked for when that is recognised,
 *  otherwise the server default. Exported so a generation can RECORD what it really used — a page
 *  stores this, and its aspect-ratio variants are later drawn from the stored value so they match
 *  the page instead of whatever the server is set to by then. */
export function resolveArtStyleName(raw?: string): ArtStyleName {
  return isArtStyleName(raw) ? raw : getDefaultArtStyleName();
}

/** Composition counterpart of resolveArtStyleName. */
export function resolveCompositionName(raw?: string): CompositionName {
  return isCompositionName(raw) ? raw : getDefaultCompositionName();
}

/** The best composition for each style, used when the requested View is "auto" (the default). Chosen
 *  so the style and the camera reinforce each other instead of fighting: a handmade felt-diorama look
 *  wants the diorama view, a flat print wants the flat view, an editorial architectural plate wants
 *  the isometric view. tiltshift owns its own camera (getArtStyleBlock skips the composition for it),
 *  so its entry is a placeholder that never reaches the prompt — the client shows "built-in" for it
 *  instead (see VIEW_LOCKED_STYLES). */
export const AUTO_VIEW: Record<ArtStyleName, CompositionName> = {
  felt: "diorama",
  papercut: "flat",
  riso: "flat",
  pixel: "diorama",
  editorial: "isometric",
  tiltshift: "diorama",
};

/** Styles whose View is fixed by the style itself, so a picker should offer no view choice for them.
 *  One source of truth for the rule; getArtStyleBlock (which skips the composition), the picker, and
 *  the stored provenance all read it through isViewLocked rather than naming a style. */
export const VIEW_LOCKED_STYLES: ArtStyleName[] = ["tiltshift"];

/** Whether a style owns its own View (fixes its own camera), so the composition slot does not apply. */
export function isViewLocked(style: ArtStyleName): boolean {
  return VIEW_LOCKED_STYLES.includes(style);
}

/** The composition a page is actually drawn in, from its style and the requested View. The View may
 *  be a concrete composition, or "auto" (the default) which defers to AUTO_VIEW for the style; an
 *  unrecognised View falls back to the server default, like resolveCompositionName. Both the built
 *  prompt and the stored provenance use THIS, so a page never stores "auto" — it stores the concrete
 *  view it was drawn in, which keeps aspect-ratio re-draws consistent. */
export function resolveCompositionForStyle(style?: string, composition?: string): CompositionName {
  if (composition === AUTO_COMPOSITION) return AUTO_VIEW[resolveArtStyleName(style)];
  return resolveCompositionName(composition);
}

/** Human label taken from a section's own "## <Keyword>: …" heading, so a picker can never drift
 *  out of sync with the prompt text it selects — there is one source of truth, art-style.md. */
function headingLabel(section: string, keyword: string, fallback: string): string {
  const heading = new RegExp(`^##\\s*${keyword}:\\s*(.+)$`, "m").exec(section)?.[1]?.trim();
  const text = heading ?? fallback;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function listArtStyles(): { name: ArtStyleName; label: string }[] {
  const { styles } = sections();
  return STYLE_NAMES.map((name) => ({ name, label: headingLabel(styles[name], "Style", name) }));
}

export function listCompositions(): { name: CompositionName; label: string }[] {
  const { compositions } = sections();
  return COMPOSITION_NAMES.map((name) => ({ name, label: headingLabel(compositions[name], "Composition", name) }));
}

/**
 * Layout furniture + one composition block + one style block — the text
 * wrapped into every image prompt. An unknown or absent `style`/`composition` falls back to the
 * server default rather than erroring: a bad value should render the house look, never break a
 * generation.
 */
export function getArtStyleBlock(style?: string, composition?: string, provider?: string): string {
  const styleName = resolveArtStyleName(style);
  const compName = resolveCompositionName(composition);
  const { layout, compositions, styles, styleVariants } = sections();
  // A style may ship a per-provider variant (e.g. tiltshift@gemini): different image models read the
  // same intent from differently-worded prompts, so the block is tuned per provider. A provider with
  // no variant — or a request that names none — falls back to the base style text.
  const styleText = (provider !== undefined && styleVariants[styleName][provider]) || styles[styleName];
  // A view-locked style (e.g. tilt-shift) fixes its own camera — a real high-angle lens with natural
  // perspective — so it skips the craft compositions (flat / isometric / diorama), whose parallel or
  // flat projections have no focal plane for the blur to sit on; pairing them fought the effect in
  // testing. The whole look lives in the style block. Rule lives in VIEW_LOCKED_STYLES, read here.
  if (isViewLocked(styleName)) return `${layout}\n\n${styleText}`;
  return `${layout}\n\n${compositions[compName]}\n\n${styleText}`;
}

export interface BuildImagePromptOptions {
  /** Whether a reference image is passed to the image provider alongside this prompt, and how to
   *  treat it. "reuse" (tap/edit) keeps the reference's scene as the base for continuity; "none"
   *  (search/root) authors a fresh page. Search never carries a reference image, so it is "none". */
  reference?: "none" | "reuse";
  /** Which composition block (flat / diorama) to include. Falls back to the server default. */
  composition?: string;
  /** The image provider that will draw this page (e.g. "gemini", "ark"). Selects a per-provider
   *  style variant when one exists in art-style.md; falls back to the base style text otherwise. */
  provider?: string;
}

/** Task framing, sent first. Uses the proven prompt order (framing -> style ->
 *  quality -> `Content:`), which lands markedly better on modern image models (Gemini / GPT Image /
 *  nano-banana) than appending the style after the content did. Model-agnostic: it states what to
 *  make and that the page's own text is part of the artwork, nothing style-specific. */
const FRAMING =
  "You can generate a new visual article expanding on the chosen topic. The result is one single, " +
  "self-contained page: a highly detailed, beautifully composed illustration of the scene described " +
  "below, with its title, callout labels and footer caption drawn as an integral part of the artwork.";

/** Appended to FRAMING only when a reference image accompanies the request (tap/edit), so continuity
 *  is asked for explicitly — the opposite of asking for an "entirely new composition", because our
 *  tap/edit flows deliberately keep the parent scene. */
const REFERENCE_REUSE =
  " A reference image is provided: keep its overall scene, layout and rendering as the base, and apply " +
  "the content described below on top of it so the result reads as the same place.";

/** Quality / integration directives, sent just before the content — the closer, which
 *  measurably lifts composition and legibility. Positive phrasing replaces the old Seedream-era
 *  defensive text-locking. */
const QUALITY =
  "Make every element beautiful, well-organized, clearly legible and native to the medium, integrated " +
  "into one coherent picture rather than pasted on top. Render all lettering crisply, spelled exactly " +
  "as written.";

/**
 * Wraps a content-only prompt (authored by page-author.md / edit-author.md) in the art style and
 * framing to form the full image prompt. Order is framing -> art style -> quality -> `Content: …`.
 * Because the style text ends up inside the built prompt, the prompt-hash image cache (layer 3)
 * keys on it automatically — switching style can never serve back an image drawn in the
 * previous one.
 */
export function buildImagePrompt(contentPrompt: string, style?: string, opts?: BuildImagePromptOptions): string {
  const framing = opts?.reference === "reuse" ? FRAMING + REFERENCE_REUSE : FRAMING;
  return `${framing}\n\n${getArtStyleBlock(style, opts?.composition, opts?.provider)}\n\n${QUALITY}\n\nContent: ${contentPrompt}`;
}
