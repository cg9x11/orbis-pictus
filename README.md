# Orbis Pictus

An infinite "browser". Every page is one AI-generated image, not HTML.

You type anything, and the app draws a page in real time. You click anything inside that image, and
the app draws a new page about the thing you clicked. There is no markup and there are no links. The
app draws every pixel on demand.

![Demo: the landing page, a generated page, a tap with a page-transition morph, and breadcrumb navigation](docs/demo.gif)

This project is an **independent, open-source homage** to [flipbook.page](https://flipbook.page). The
flipbook.page team did not build it, endorse it, or approve it. It exists because one idea was
interesting enough to rebuild from the start: a whole browsing experience made of generated images
only.

The name comes from *Orbis Sensualium Pictus*. Comenius published this book in 1658, and it was the
first picture encyclopedia. Every entry was a labeled illustration, not a block of text. This project
makes the same trade 368 years later.

## Features

- **Infinite tap-to-explore navigation.** You click anything on the current page. The app draws a new
  page around that thing. There is no map and no link graph behind it.
- **Search and edit, not only tap.** You type a query to start anywhere. Over an open page you type a
  command such as "make it night time", and the app draws that page again.
- **Breadcrumb address bar.** Every page you visit is a real stop on a trail. You can step back, step
  forward, or jump straight to any ancestor.
- **Page-transition morphs (optional).** A generated clip shows the parent page as it melts into the
  child. The clip plays in reverse on the way back. Longer jumps get a crossfade instead.
- **Idle-loop video (optional).** A short clip of water, steam, or light cross-fades in over the
  static image of a finished page.
- **Tap caching.** Repeat clicks near the same point reuse earlier work. A subject already explored
  under the same parent also reuses earlier work.
- **Photo upload (optional).** You can start from your own image instead of a generated one.
- **Web search grounding (optional).** A real web search can ground the page content, instead of the
  knowledge of the model.
- **Style and composition pickers.** You can swap the visual style of the whole app (felt, papercut,
  riso, pixel, editorial). You can also swap the projection (flat, isometric, diorama). Both change
  per page, with no restart.

## Supported providers

| Role | Providers |
|---|---|
| Prompt authoring + tap vision (LLM) | Anthropic (or any Anthropic-compatible proxy) · Google Gemini |
| Image generation | fal.ai · BytePlus Ark (Seedream) · Google Gemini ("nano banana") · OpenAI (gpt-image) |
| Idle-loop video + page-transition morphs | BytePlus Ark (Seedance) |
| Web search grounding | Anthropic-compatible provider's server-side web-search tool |

The **Configuration** section below lists the environment variables for each role.

## How it works

**The loop.** A query, a click, or a typed edit command becomes one request to a single SSE endpoint,
`POST /api/generate`. The endpoint streams back `start → [tap_subject] → preview → complete`, or
`error`. Three request modes share this one endpoint:

- `search` — the user typed a query.
- `tap` — the user clicked a point on the current page.
- `edit` — the user typed a command over an open page ("make it night time").

**The tap trick.** There is no API for click coordinates. When you tap the image, the client draws
the *current page* onto a canvas. It paints a marker at the exact click point: a red circle with a
white halo and crosshair ticks (`apps/web/src/lib/tapMarker.ts`). The client exports the canvas as a
JPEG and sends the whole marked-up image to the server. A vision model looks at the picture and names
the thing under the marker.

That name streams back at once as a `tap_subject` event, so the address bar updates before the next
image starts. The name then feeds the author prompt for the child page. The original site uses the
same trick. We found it by reading the network traffic of that site.

**Content and style are two separate prompts.** The LLM that authors each page
(`apps/server/src/prompts/page-author.md` and `edit-author.md`) writes content only. Content means
the title, the layout, every exact string to draw, and which regions get callouts. The prompt forbids
the LLM to describe style, palette, material, or lighting.

A second, fixed file owns the visual style: `apps/server/src/prompts/art-style.md`. The server appends
this file to every image prompt. The default style is a needle-felted-wool diorama, and `ART_STYLE`
selects one of four alternates. Because of this split, every page shares one look whatever the topic.
One file edit changes the look of the whole app.

`COMPOSITION` is a second, independent axis. It picks the projection for the scene: `flat`,
`isometric`, or `diorama` (default `diorama`). The two axes combine freely, so "editorial style,
isometric composition" and "felt style, diorama composition" are both valid pages.

The style file also holds one rule that we learned from failures. A prompt must supply an exact string
for every text region on the page. If a region has no string, the image model invents one. The result
is garbled text, or a fabricated subtitle under a title.

**Three cache layers.** The app applies all three on every tap, and all three are optional.

1. **Coordinate-grid VLM cache** — the app quantizes clicks to a coarse grid, one grid per page. A
   nearby repeat click reuses the subject that the vision model already named, and skips that call.
2. **Subject-level child dedup** — once the subject is known, the app reuses an existing child node
   under the same parent with the same normalized subject. Navigation is instant and costs nothing.
3. **Prompt-hash image cache** — repeated searches often produce byte-identical prompt text. In that
   case the app serves the earlier image instead of a new one.

`TAP_DEDUP=variant` keeps the savings on vision-model calls but always draws a fresh image.
`TAP_DEDUP=off` matches the always-fresh behavior of the original site exactly.

**Idle-loop video** (experimental, off by default). If `VIDEO_ENABLED=true`, the server generates a
short looping video after a page completes. It builds the video in the background from the image of
that page, for example steam that drifts or water that ripples. The video cross-fades in over the
static image when it is ready. The **Known limitations** section lists the current problems.

**Page-transition morphs** (experimental, off by default). A child page is any page with a parent,
from a tap or an edit. If `MORPH_ENABLED=true`, the server generates a clip in the background after a
child page completes. The parent image is the first frame and the child image is the last frame. The
tapped subject stays anchored on screen while the rest of the page repaints into the new one.

The transition waits for this clip. When the image of the new page is ready, the app stays on the page
you leave until the clips of that page are complete. It then plays the morph straight into the new
page. The morph therefore appears on the *first* tap, not only on a later visit. A timeout bounds this
wait, and the wait happens only while the per-session cap has room. Past the cap, or with the feature
off, navigation is instant.

Some pages miss their chance. Two examples are a page created while video was off, and a page reopened
from a cached-tap marker. A cached-tap marker never runs the generate pipeline. The
**✨ Animate page** button gives both clips to these pages later.

One step *back* replays the same clip in reverse. A morph interpolates from the parent image to the
child image, first frame to last frame. Its reverse is therefore the exact parent-ward transition.
This costs no second generation and no extra video quota. The app writes a local `ffmpeg -vf reverse`
re-encode next to the original clip (`MORPH_REVERSE`, on by default). Without ffmpeg, this does not
happen.

A jump further than one step spans several parent/child pairs. A breadcrumb jump to a distant ancestor
is one example. No single clip can represent such a jump, so these jumps get a short crossfade.

We ran this feature against the live Ark API frame by frame before we built it. The current model does
not hold the camera perfectly still, even with an explicit fixed-camera instruction. The movement
reads more like a deliberate zoom into the tapped subject than like drift. It is still a real
deviation from the prompt, not a style choice.

## Setup

This project needs Node 22.5 or later. It uses the built-in `node:sqlite` module, which is still
experimental at that version. The warning that the server prints at startup is expected and harmless.

```bash
npm install
cp .env.example .env                # secrets (API keys) go here
cp config.example.yml config.yml    # everything else (providers, models, flags) — optional
npm run dev:server                  # http://localhost:8787
npm run dev:web                     # http://localhost:5173
```

Run `npm run dev:server` and `npm run dev:web` in two terminals. The web app proxies `/api` and
`/images` to the server. Then do these three steps:

1. Open http://localhost:5173.
2. Type a query.
3. Click anywhere in the image.

> **Free credits, for tests.** BytePlus Ark gives free credits to a new account. These credits cover
> image generation and video generation. You can therefore try every feature with no payment.
>
> 1. Register an account at https://ai.byteplus.com.
> 2. Create an API key.
> 3. Turn on "Free Credits Only" mode for that account.
> 4. Put the key in `.env` as `ARK_API_KEY`.
> 5. Set `IMAGE_PROVIDER=ark` in the same file.
> 6. If you want idle-loop video, set `VIDEO_ENABLED=true` and `VIDEO_PROVIDER=ark`.
> 7. If you want page-transition morphs, also set `MORPH_ENABLED=true`.

### Configuration

The configuration is split by sensitivity. The app resolves each value with a fixed precedence:

> **model panel in the browser  >  environment variable  >  `config.yml`  >  built-in default**

You can change the provider and the model for images and video from the browser. This needs no restart
and no file edit. The **⚙ Models** button in the toolbar opens the panel, and the section
[Choosing models from the UI](#choosing-models-from-the-ui) describes it. Every other value resolves
from the environment, then `config.yml`, then the built-in default.

- **`config.yml`** (non-secret, gitignored — copy it from `config.example.yml`): provider selection,
  model names, feature flags, and tunable values. The structure is nested, which keeps it manageable
  as the number of providers grows. This file is optional. Without it, every value falls back to the
  environment or to the default.
- **`.env`** (secrets, gitignored — copy it from `.env.example`): API keys, plus any environment
  override that you want to force. Because the environment wins, a deployment can override one
  `config.yml` value with no file edit.

The app always needs one LLM provider and one image provider. Everything else has a safe fallback. The
table below names each value by its environment override. `config.example.yml` shows the matching path
inside `config.yml`.

| Env override | Purpose | Values |
|---|---|---|
| `LLM_PROVIDER` | Prompt authoring + tap vision model | `anthropic` (Anthropic Messages API — works with a real Anthropic key **or** any Anthropic-compatible proxy through `LLM_BASE_URL`) · `gemini` · `mock` (default when no key is set) |
| `LLM_API_KEY`, `LLM_BASE_URL` | Credentials and endpoint for the `anthropic` provider | `LLM_BASE_URL` has no `/v1` suffix. The SDK appends `/v1/messages` itself |
| `PROMPT_AUTHOR_MODEL`, `TAP_VLM_MODEL` | Which models to call through that provider | Any model id that your endpoint serves. The VLM model must accept image input |
| `GEMINI_API_KEY` | Credentials for the `gemini` provider | — |
| `IMAGE_PROVIDER` | Image generation | `fal` (fal.ai) · `ark` (BytePlus Ark / Seedream) · `gemini` (Google "nano banana") · `openai` (gpt-image) · `mock` (default when no key is set) |
| `ARK_API_KEY`, `ARK_BASE_URL` | Credentials and endpoint for `ark` | — |
| `ARK_IMAGE_MODEL`, `ARK_IMAGE_MODEL_FALLBACK` | Primary model, plus an automatic fallback for quota errors | For example `seedream-4-5-251128` and `seedream-4-0-250828` |
| `FAL_KEY`, `IMAGE_MODEL` | Credentials and model for `fal` | — |
| `GEMINI_API_KEY`, `GEMINI_IMAGE_MODEL` | Credentials and model for `gemini` image | For example `gemini-3.1-flash-lite-image` · `gemini-3.1-flash-image` · `gemini-3-pro-image` |
| `OPENAI_API_KEY`, `OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_QUALITY` | Credentials, model, and quality for `openai` image | For example `gpt-image-1.5`. Quality is `low`, `medium`, or `high` |
| `SEARCH_PROVIDER` | Optional web search grounding for page content | `llm` (uses the server-side web-search tool of the Anthropic-compatible provider) · `none` |
| `SEARCH_MODEL` | Model for the search | — |
| `ART_STYLE` | Fixed visual style for every page | `felt` (default) · `papercut` · `riso` · `pixel` · `editorial` |
| `COMPOSITION` | Projection for every page, independent of `ART_STYLE` | `diorama` (default) · `flat` · `isometric` |
| `TAP_DEDUP` | Tap caching mode (see above) | `reuse` (default) · `variant` · `off` |
| `VIDEO_ENABLED` | Master switch for idle-loop video | `false` (default) |
| `VIDEO_PROVIDER` | Video generation | `ark` (BytePlus Seedance) · `mock` (default even when `ARK_API_KEY` is set — video is opt-in separately from images) |
| `ARK_VIDEO_MODEL`, `VIDEO_RESOLUTION`, `VIDEO_DURATION_SECONDS`, `VIDEO_MAX_PER_SESSION` | Video tuning, plus a hard per-session cap | — |
| `MORPH_ENABLED` | Master switch for page-transition morphs | `false` (default) |
| `MORPH_MAX_PER_SESSION` | Hard per-session cap on morph generations. Reuses `VIDEO_PROVIDER`, `ARK_VIDEO_MODEL`, `VIDEO_RESOLUTION`, and `VIDEO_DURATION_SECONDS` above | — |
| `MORPH_REVERSE` | Re-encode each morph backwards, so that one step back replays it in reverse. Needs `ffmpeg` on PATH. Costs no video quota. Off means that back-navigation crossfades | `true` (default) |
| `PORT`, `DATABASE_URL`, `IMAGES_DIR` | Server port, SQLite file path, and disk path for generated images | — |

### Choosing models from the UI

The **⚙ Models** button in the toolbar opens a panel. The panel holds the provider, the model, the
video resolution, and the clip length, for images and for video. You can compare two models with no
restart.

How it behaves:

- The browser stores your choice, not the server. The choice survives a reload. Two tabs can use two
  different models, and your choice changes nothing for anybody else.
- Each choice rides along with the request. `config.yml` stays the default for anything you leave
  alone. **Reset to server defaults** therefore always returns to the configured setup.
- Only new pages change. A page already drawn keeps the model that drew it, because a second draw
  costs money again.
- The model box also accepts free text. Model ids change faster than the built-in list, so you can
  type a new one.

If the app cannot use your choice, it still draws the page and shows a blue notice with the reason:

- A provider with no API key falls back to the configured provider.
- A model that the provider rejects falls back to the configured model.

We ran this fallback against the live BytePlus Ark, Google Gemini, and fal.ai APIs. The OpenAI branch
follows their published error contract, but we did **not** run it live.

The server caps a clip length from the browser at 12 seconds
(`MAX_OVERRIDE_DURATION_SECONDS` in `apps/server/src/pipeline/videoConfig.ts`). It does not cap a
value from `config.yml`.

> **WARNING: Run this app on localhost, or put your own gate in front of it.** The app has no
> authentication anywhere. Anyone who can reach the server can change these values and spend your API
> credit. Video spends quota quickly.

### Add an image provider

One file is enough to add an image provider. There is no `switch` or `if` to change.

1. Create a module under `apps/server/src/providers/image/`.
2. Export an `ImageProviderFactory` from that module (see `registry.ts`).
3. Add the module to the array in `image/index.ts`.

Each factory owns its own key lookup and its own configuration. `referenceImageDataUrl` gives tap and
edit continuity, and each provider can use it or ignore it. `gemini` uses it. `openai` ignores it at
present.

## Cost

One real page costs about one LLM call and one image generation. A tap costs one extra vision-model
call. With Seedream 4.5 on BytePlus Ark, one image costs about **$0.03**. The LLM cost depends on the
model behind `LLM_PROVIDER`. The defaults above assume an account or a proxy that you already
configured.

There is no two-tier draft/final draw here. The app draws every page once, at one quality level, which
holds the per-page cost to that single image call. Video and morphs cost much more per page than an
image. For that reason each one has a hard per-session cap: `VIDEO_MAX_PER_SESSION` and
`MORPH_MAX_PER_SESSION`.

## Known limitations

- **Compound Vietnamese diacritics can come out wrong, and the result depends on the image model.** A
  base modifier plus a tone mark is the hard case ("Hà Nội" → "Hà Nỗi", "Hoàn Kiếm" → "Hoàn Kiêm"). A
  lower-tier model, such as the default Seedream tier here, gets these wrong more often than right.
  This happens even when the prompt spells the name in plain letters, because the model
  "auto-corrects" it back to an accented spelling. The workaround is aggressive: the prompt spells
  these proper nouns in plain ASCII and adds an anti-example that names the accented variants to
  avoid. This helps measurably, but it is not airtight — a higher-tier image model draws these names
  correctly with no workaround.
- **Dense pages with 7 or 8 callouts can still merge or drop a label on a weaker image model.** Two
  adjacent callouts sometimes blend into one garbled plaque. A label sometimes goes missing while its
  leader line and its drawn subject stay correct. Lower callout counts of 4 to 6 are more reliable on
  any model. A stronger image model handles the higher end better.
- **Idle-loop video can make text unstable, and the result depends on the video model.** Small
  secondary text can visibly mutate from frame to frame during video generation. This happens even with an explicit
  instruction not to redraw any text. The title card and the footer caption hold up well. Anything
  smaller and lower in contrast is at risk on a weaker model. The art style now forbids invented
  secondary text regions, so this is mostly a residual risk, not a routine error.
- **Page-transition morphs are pre-generated, not real-time.** The original site streams a live video
  transition over a WebSocket to a self-hosted model as you tap. This project does not reproduce that
  architecture, by choice. Instead the server generates the clip as one whole file after the tap or the
  edit completes, and the transition waits for it. A step into a new page therefore takes noticeably
  longer with morphs on than with morphs off, and the original site stays interactive throughout. The
  model also does not hold the camera perfectly fixed, even though the prompt asks for it (see
  **How it works**).

## Roadmap

In priority order:

1. A real waitroom and rate-limiting layer for public deployments.
2. An S3/R2 storage driver.
3. More work on the callout-density limit and the diacritics limit above, as image models improve.

## License

MIT. See `LICENSE`.
