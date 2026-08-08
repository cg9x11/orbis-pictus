Rendering style and layout contract. `pipeline/artStyle.ts` wraps the LLM's content-only prompt in
flipbook.page's proven order for modern image models (Gemini / GPT Image / nano-banana): task framing
→ this style block → quality directives → `Content: <authored text>`. The framing and quality
directives live in `artStyle.ts`; this file owns the layout furniture + one composition block
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
3. This file owns which text-bearing regions exist on the page (the page title, the callout plaques,
   the footer caption) — it must never describe a region without also saying what fills it. Every
   string that carries meaning — the title, each callout label, the footer caption — is supplied
   exactly by a prompt (this file or the content prompt it's appended to) and must render verbatim;
   a callout label the model invents asserts a fact nobody checked. The renderer may, however, add
   a decorative supporting line of its own near the title or the caption (a subtitle, a location, a
   date). That was once banned outright, because on Seedream 4.x anything the model wrote itself came
   out garbled — modern models render it cleanly and it reads well, so the ban cost more than it
   bought. If a future style or layout change adds a new text-bearing region here, it must ship with
   matching instructions in page-author.md/edit-author.md for supplying that region's exact text —
   never leave one implicit.

The sections below are machine-parsed by `pipeline/artStyle.ts` via the `<!-- art-style:* -->`
anchor comments — keep them intact when editing prose. Style selected by env `ART_STYLE=felt|
papercut|riso|pixel|editorial` (default `felt`); composition by env `COMPOSITION=flat|isometric|diorama`
(default `diorama`). The layout section is style-independent and always included.

---

<!-- art-style:layout -->
## Layout (style-independent)

The page is an educational infographic. Callout labels connect to their subject with thin leader
lines. Each label is a flat, clean, high-contrast plaque with a bold label line and a smaller
description line beneath it. The page title sits at the top and a short caption sits at the bottom;
how those two are presented is yours to judge, and you may add a supporting line of your own near
either — a subtitle, a location, a date — so long as everything reads clearly against whatever is
behind it. A small context inset may sit in a bottom corner. All lettering stays sharp and perfectly
legible.

The artwork itself fills the whole frame and runs off all four edges, with the title, plaques and
caption sitting on top of it — no outer border, panel, mat or margin framing the picture.

Keep the scene to five or six labelled elements — fewer, larger subjects read far better than a
crowded page.

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
