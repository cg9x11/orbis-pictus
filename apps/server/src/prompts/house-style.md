Rendering style and layout contract, appended verbatim to every image prompt.

This file is the single source of the app's visual identity. The page-author LLM writes CONTENT
only (title, layout, exact label strings) and must never describe style — swapping the app's
entire look is an edit to this file alone.

Two hard-won rules, verified against Seedream 4.5 on 2026-08-06 (see PLAN §2):
1. NEVER write hex colour codes here. Every hex code in an earlier version of this text was
   rendered as visible text inside the picture — shop signs reading "#F2EDE", a page title that
   became "Soote Many (#FF7A2)". Name colours in words.
2. Keep the label-plaque paragraph intact regardless of which style block is active. The entire
   product is rendered text; if the scene's texture is allowed to touch the type, the page stops
   being readable. Textured styles need this exemption most, not least.

The sections below are machine-parsed by `pipeline/houseStyle.ts` via the `<!-- house-style:* -->`
anchor comments — keep them intact when editing prose. Selected by env `HOUSE_STYLE=felt|papercut|
riso|pixel` (default `felt`); the layout section is style-independent and always included.

---

<!-- house-style:layout -->
## Layout (style-independent)

Composition: an isometric three-quarter aerial view of a miniature diorama scene, with the main
subject rendered oversized and hero-scale inside a small believable environment — never flat icons
on a blank background. Callout labels point to their subject with thin leader lines.

Each label is a flat, clean, high-contrast plaque with crisp legible type: a bold label line and a
smaller description line underneath. The page title sits in a flat card at the top. A solid footer
bar runs across the bottom with a short caption. A small context inset sits in the bottom-right
corner.

All text must be sharp, perfectly legible, correctly spelled, and must never be painted, extruded,
embroidered, pixelated, or wrapped onto a three-dimensional surface — the plaques, the title card
and the footer are always flat, smooth overlays sitting above the scene, whatever the scene is made
of. Never draw colour codes, hex values, or any technical notation anywhere in the picture.

Keep the scene to five or six labelled elements. Felted wool loses fine detail, so fewer, larger
subjects read far better than a crowded page.

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

<!-- house-style:end -->
