Rendering style and layout contract. `pipeline/artStyle.ts` wraps the LLM's content-only prompt in
the proven order for modern image models (Gemini / GPT Image / nano-banana): task framing
→ this style block → quality directives → `Content: <authored text>`. The framing and quality
directives live in `artStyle.ts`; this file owns the layout furniture + one composition block
(flat / diorama) + one style block, assembled in that order.

This file is the single source of the app's visual identity. The page-author LLM writes CONTENT
only (the scene layout, and every subject's exact appearance and position) and must never describe
style — swapping the app's entire look is an edit to this file alone.

**The image carries no text at all.** The page title, every callout label, and the footer caption
are real on-screen text the app draws itself, as a DOM overlay on top of this image, after
generation. None of that text is part of the artwork. This file must never ask the image model to
draw a title, a label plaque, a caption strip, a sign, a placard, or any lettering of any kind —
verbatim rendering of that text is now guaranteed by the browser drawing it directly, not by
prompt-engineering the image model to copy a string correctly.

Two file-authoring rules (learned on Seedream 4.5, kept as hygiene now that the app targets modern
models — they cost nothing and still prevent avoidable failures):
1. NEVER write hex colour codes here. Every hex code in an earlier version of this text was
   rendered as visible text inside the picture — shop signs reading "#F2EDE", a page title that
   became "Soote Many (#FF7A2)". Name colours in words.
2. Keep the "no text at all" instruction intact regardless of which style block is active. A style
   block describes materials and texture only; it must never re-introduce a text-bearing region
   (a sign, a plaque, a label) that the layout section above it forbids.

The sections below are machine-parsed by `pipeline/artStyle.ts` via the `<!-- art-style:* -->`
anchor comments — keep them intact when editing prose. Style selected by env `ART_STYLE=felt|
papercut|riso|pixel|editorial` (default `felt`); composition by env `COMPOSITION=flat|isometric|diorama`
(default `diorama`). The layout section is style-independent and always included.

---

<!-- art-style:layout -->
## Layout (style-independent)

The image is a clean scene with NO text, letters, words, signs, plaques, or writing of any kind
anywhere in it. Do not draw a title banner, a label plaque, a caption strip, a sign, a placard, or
any lettering, even blank or illegible ones — the app draws all of that itself, afterward, as real
on-screen text on top of this image.

Leave open, uncluttered space near the top of the frame (the title is added there afterward) and
near the bottom (the caption is added there afterward) — do not fill those margins with dense
detail that would make text added later hard to read against it.

The artwork itself fills the whole frame and runs off all four edges — no outer border, panel, mat
or margin framing the picture.

Keep the scene to four to six clearly distinct labelled subjects, each with its own clear area and
visible separation from its neighbours — fewer, larger subjects read far better than a crowded
page, and each one needs room for a label to sit near it without overlapping the scene's own
detail.

<!-- art-style:composition-flat -->
## Composition: flat infographic

Arrange the page as a flat, front-on educational infographic: clean two-dimensional panels and
vignettes laid out on an open background with generous negative space, the main subject centred and
largest, the other elements placed clearly around it. No perspective and no isometric tilt — a crisp,
diagrammatic, poster-like plane.

<!-- art-style:composition-isometric -->
## Composition: isometric diagram

A highly detailed isometric (axonometric) illustration of one single scene, drawn like an architectural
plate or an isometric map: top-down isometric perspective, parallel projection, no perspective
convergence.

The whole page is ONE continuous place. Its setting — the ground, terrain, floor or surface the subject
belongs to — runs unbroken beneath everything and continues past all four edges of the frame, so the
outer edge of that ground is never visible. Every element sits inside that setting and is connected by
it, with the space between elements filled by more of the same place rather than left empty.

Environment-rich and intricate, yet composed, uncluttered and legible: the main subject reads largest
and most central, the rest arranged clearly around it on the same ground. Precise, editorial and
diagrammatic — not a handmade miniature-diorama world.

<!-- art-style:composition-diorama -->
## Composition: isometric diorama

Arrange the page as an isometric three-quarter aerial view of a miniature diorama scene: the main
subject rendered oversized and hero-scale inside a small believable environment, the other elements
as little dimensional scenes around it — never flat icons on a blank background.

<!-- art-style:felt -->
## Style: needle-felted wool

Rendering style: needle-felted wool craft, photographed as a handmade miniature diorama. Every
surface is soft matte wool with visible fibre fuzz, slightly irregular hand-shaped forms, and
visible stitches and seams. Cosy palette of oatmeal, dusty rose, sage green, mustard and soft denim
blue on a warm ivory backdrop. Soft diffused window light, gentle shadows, shallow depth of field.
Warm, tactile, handmade and imperfect — nothing sleek, glossy, or digital.

<!-- art-style:papercut -->
## Style: layered cut-paper

Rendering style: layered cut-paper craft — best legibility of the craft styles; a shadow box built
from stacked sheets of coloured construction paper, each layer dropping a small crisp shadow on the
one below, with torn and scissor-cut edges and faint paper fibre. Bright flat colours, no gradients:
coral, marigold, leaf green, sky blue, cream.

<!-- art-style:riso -->
## Style: risograph

Rendering style: risograph print — highest legibility overall; no outlines, forms are flat blocks of
overprinted ink with deliberate slight misregistration, coarse halftone grain and visible paper
tooth. Four inks only on warm cream paper: fluorescent pink, teal, deep navy, turmeric.

<!-- art-style:pixel -->
## Style: cosy pixel art

Rendering style: cosy pixel art — strongest nostalgia; a 16-bit farming-game world with a visible
chunky pixel grid, hard pixel edges, dithered shading, and a limited retro palette of warm brown,
leaf green, sky blue, cream and soft red. The plaques stay smooth, like a game UI overlay.

<!-- art-style:editorial -->
## Style: editorial line illustration

Rendering style: refined editorial illustration in the manner of an architectural plate or museum
diagram — every form drawn with precise, fine ink outlines and flat, lightly shaded fills, clean and
legible, never cartoonish and never photographic. Restrained, desaturated palette of soft warm greys,
natural greens and muted slate blue with sparing warm accents, all on a plain cream paper ground. Soft
diffuse light, no harsh shadows; a calm, composed, technical-drawing quality throughout.

<!-- art-style:end -->
