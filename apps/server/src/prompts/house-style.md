Rendering style and layout contract. `pipeline/houseStyle.ts` wraps the LLM's content-only prompt in
flipbook.page's proven order for modern image models (Gemini / GPT Image / nano-banana): task framing
→ this style block → quality directives → `Content: <authored text>`. The framing and quality
directives live in `houseStyle.ts`; this file owns the layout furniture + one composition block
(flat / diorama) + one style block, assembled in that order.

This file is the single source of the app's visual identity. The page-author LLM writes CONTENT
only (title, layout, exact label strings) and must never describe style — swapping the app's
entire look is an edit to this file alone.

Three file-authoring rules (learned on Seedream 4.5, kept as hygiene now that the app targets modern
models — they cost nothing and still prevent avoidable failures):
1. NEVER write hex colour codes here. Every hex code in an earlier version of this text was
   rendered as visible text inside the picture — shop signs reading "#F2EDE", a page title that
   became "Soote Many (#FF7A2)". Name colours in words.
2. Keep the label-plaque paragraph intact regardless of which style block is active. The entire
   product is rendered text; if the scene's texture is allowed to touch the type, the page stops
   being readable. Textured styles need this exemption most, not least.
3. This file owns which text-bearing regions exist on the page (title card, callout plaques,
   footer bar) — it must never describe a region without also saying what fills it, and every
   rendered string anywhere on the page must be an exact string supplied by a prompt (this file
   or the content prompt it's appended to), never text the image model has to invent. An
   unspecified text region is always garbled or free-invented in practice: the footer caption
   bug and a free-invented subtitle line under the title card (never part of this layout, added
   by the authoring LLM on its own) both traced back to exactly this. If a future style or layout
   change adds a new text-bearing region here, it must ship with matching instructions in
   page-author.md/edit-author.md for supplying that region's exact text — never leave one
   implicit.

The sections below are machine-parsed by `pipeline/houseStyle.ts` via the `<!-- house-style:* -->`
anchor comments — keep them intact when editing prose. Style selected by env `HOUSE_STYLE=felt|
papercut|riso|pixel|editorial` (default `felt`); composition by env `COMPOSITION=flat|isometric|diorama`
(default `diorama`). The layout section is style-independent and always included.

---

<!-- house-style:layout -->
## Layout (style-independent)

The page is an educational infographic. Callout labels connect to their subject with thin leader
lines. Each label is a flat, clean, high-contrast plaque with a bold label line and a smaller
description line beneath it. The page title sits in a flat card at the top carrying the title text
only. A solid footer bar runs across the bottom with a short caption, and a small context inset may
sit in a bottom corner. The plaques, title card and footer are flat, smooth overlays resting above
the scene whatever the scene is made of, and their text stays sharp and perfectly legible.

Keep the scene to five or six labelled elements — fewer, larger, well-spaced subjects read far better
than a crowded page.

<!-- house-style:composition-flat -->
## Composition: flat infographic

Arrange the page as a flat, front-on educational infographic: clean two-dimensional panels and
vignettes laid out on an open background with generous negative space, the main subject centred and
largest, the other elements placed clearly around it. No perspective and no isometric tilt — a crisp,
diagrammatic, poster-like plane.

<!-- house-style:composition-isometric -->
## Composition: isometric diagram

Arrange the page as a clean isometric (axonometric) diagram, like an architectural plate or an
isometric map: parallel projection with no perspective convergence — parallel lines stay parallel and
distant elements do not shrink or fade. The main subject sits centred and largest, the other elements
as clear isometric forms arranged around it on an open background. Precise, editorial and diagrammatic
— not a handmade miniature-diorama world.

<!-- house-style:composition-diorama -->
## Composition: isometric diorama

Arrange the page as an isometric three-quarter aerial view of a miniature diorama scene: the main
subject rendered oversized and hero-scale inside a small believable environment, the other elements
as little dimensional scenes around it — never flat icons on a blank background.

<!-- house-style:felt -->
## Style: needle-felted wool

Rendering style: needle-felted wool craft, photographed as a handmade miniature diorama. Every
surface is soft matte wool with visible fibre fuzz, slightly irregular hand-shaped forms, and
visible stitches and seams. Cosy palette of oatmeal, dusty rose, sage green, mustard and soft denim
blue on a warm ivory backdrop. Soft diffused window light, gentle shadows, shallow depth of field.
Warm, tactile, handmade and imperfect — nothing sleek, glossy, or digital.

<!-- house-style:papercut -->
## Style: layered cut-paper

Rendering style: layered cut-paper craft — best legibility of the craft styles; a shadow box built
from stacked sheets of coloured construction paper, each layer dropping a small crisp shadow on the
one below, with torn and scissor-cut edges and faint paper fibre. Bright flat colours, no gradients:
coral, marigold, leaf green, sky blue, cream.

<!-- house-style:riso -->
## Style: risograph

Rendering style: risograph print — highest legibility overall; no outlines, forms are flat blocks of
overprinted ink with deliberate slight misregistration, coarse halftone grain and visible paper
tooth. Four inks only on warm cream paper: fluorescent pink, teal, deep navy, turmeric.

<!-- house-style:pixel -->
## Style: cosy pixel art

Rendering style: cosy pixel art — strongest nostalgia; a 16-bit farming-game world with a visible
chunky pixel grid, hard pixel edges, dithered shading, and a limited retro palette of warm brown,
leaf green, sky blue, cream and soft red. The plaques stay smooth, like a game UI overlay.

<!-- house-style:editorial -->
## Style: editorial line illustration

Rendering style: refined editorial illustration in the manner of an architectural plate or museum
diagram — every form drawn with precise, fine ink outlines and flat, lightly shaded fills, clean and
legible, never cartoonish and never photographic. Restrained, desaturated palette of soft warm greys,
natural greens and muted slate blue with sparing warm accents, all on a plain cream paper ground. Soft
diffuse light, no harsh shadows; a calm, composed, technical-drawing quality throughout.

<!-- house-style:end -->
