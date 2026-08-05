# Flipbook Open-Source Clone — Implementation Plan

Goal: build an open-source version of https://flipbook.page — "an infinite visual browser generated entirely on demand in real time." Every page is a single AI-generated image; clicking anything in the image generates a new image exploring that thing in more depth. No HTML content, no links — just generated pixels.

This plan is based on reverse-engineering the live site (network inspection + de-minified JS bundle `main-BPJa3Dcu.js`) and the demo video. Section 1 documents exactly how the original works; Section 2+ is our build plan.

---

## 1. How the original works (reverse-engineering findings)

### 1.1 High-level architecture

```
Browser (React SPA, Vite)
  │
  ├─ POST /api/iteratively-generate-next-page   ← SSE stream, the core endpoint
  ├─ POST/GET /api/nodes, /api/nodes/upload     ← persistence & share links
  ├─ GET  /api/image-proxy?url=...              ← proxy for CDN images (canvas-safe CORS)
  ├─ GET/POST /api/waitroom                     ← capacity queue (poll_after_ms, admitted)
  │
  ├─ Images stored at https://sketchapediacontent.com/images/{nodeId}/{landscape|portrait|square}.jpg
  │     (project codename is "Sketchapedia"; hosting: Vercel + Cloudflare)
  │
  └─ wss://...modal.run/ws/stream               ← experimental live-video (LTX-2 streaming on Modal GPUs)
```

Models used by the original (visible in node JSON):
- `prompt_author_model: "gemini-3-flash-preview"` — LLM that authors the image prompt (agentic web search + world knowledge).
- `image_model: "fal-ai/nano-banana-2"` — image generation via fal.ai (renders all text as pixels).
- Video: custom LTX-2 streaming diffusion engine (`ltx-stream-diffusers ltx2 streaming engine`) self-hosted on Modal.

### 1.2 Node data model (from `GET /api/nodes/{id}`)

```jsonc
{
  "node": {
    "id": "6dd4cbdaa48e4671b98f6d9219a890e3",   // 32-hex
    "parent_id": null,                            // tree structure
    "session_id": "session_<uuid>",
    "query": "Hà Nội travel overview",           // what the user asked / clicked
    "page_title": "Hà Nội: The Heart of Vietnam",
    "image_variants": {
      "3:4":  ".../portrait.jpg",
      "1:1":  ".../square.jpg",
      "16:9": ".../landscape.jpg"
    },
    "image_model": "fal-ai/nano-banana-2",
    "prompt_author_model": "gemini-3-flash-preview",
    "authored_prompt": "An educational travel infographic titled ... (full image prompt)",
    "created_at": "...", "version": 1
  },
  "history": [ /* ancestor chain of node objects, root → current */ ]
}
```

Share URL = `/n/{nodeId}`. Node id doubles as the image folder name.

### 1.3 The generation endpoint (SSE)

`POST /api/iteratively-generate-next-page` with `Accept: text/event-stream`. Three request modes (one endpoint):

```jsonc
// mode "search" — user typed a query in the address bar
{ "query": "...", "aspect_ratio": "16:9", "web_search": true,
  "session_id": "...", "current_node_id": "" }

// mode "tap" — user clicked a point on the current image
{ "mode": "tap",
  "image": "data:image/jpeg;base64,...",   // current page image WITH a marker drawn at the click point
  "aspect_ratio": "16:9", "web_search": true,
  "parent_query": "...", "parent_title": "...",
  "session_id": "...", "current_node_id": "..." }

// mode "edit" — user typed a command while a page is open ("make it night time")
{ "mode": "edit", "prompt": "...", "image": "<current image>", "aspect_ratio": "16:9",
  "web_search": true, "parent_query": "...", "parent_title": "...",
  "session_id": "...", "current_node_id": "..." }
```

**Key insight — the tap is communicated visually, not as coordinates.** The client draws the current image on a canvas and paints a marker at the click point: a red (`#ff3b30`) circle (radius ≈ 8.5% of min dimension, min 64px) with a white outer halo + white crosshair ticks, then exports JPEG (`quality 0.92`) and sends it. A server-side VLM looks at the marked image to decide what was clicked.

SSE events emitted by the server, in order:

| event | payload | purpose |
|---|---|---|
| `start` | — | stream opened |
| `tap_subject` | `{ subject: "Phở Bắc" }` | (tap mode) VLM names the clicked thing → shown immediately in the address bar |
| `tap_icon` | `{ image_url }` | (tap mode) small icon/thumbnail for the loading UI |
| `preview` | `{ aspectRatio, imageUrl }` | progressive partial images while generating (can fire many times) |
| `draft_complete` | full node payload (draft-res image) | fast draft ready — user may "continue with draft" |
| `draft_error`, `tap_subject_error`, `tap_icon_error` | `{ message }` | non-fatal sub-task failures |
| `complete` | full node payload with final `image_url` + `image_variants` | high-quality image done |
| `error` | `{ message }` | fatal |

Two-tier quality: draft ≈ 1280×720 / 960×1280 / 960×960; final ≈ 1920×1088 / 1088×1920 / 1088×1088. Client timeout 90 s (then offers the draft). Persistence retries: 3 attempts with backoff [1 s, 3 s, 7 s].

### 1.4 Client UX (from live site + demo video)

- Fake "browser window" chrome: address bar shows the **session breadcrumb trail** (`Paris Travel Overview / Visiting Notre Dame / ... / Tickets Confirmed`), each crumb clickable to go back; input placeholder "Continue this session".
- Landing page: type anything → first page generates with progressive preview.
- Click anywhere on the image → ripple animation at click point + `tap_subject` name appears → new page slides in. History is linear per session (back/forward through the trail).
- Aspect ratio picker (16:9 / 3:4 / 1:1), "web search" toggle, upload-your-own-image entry point, share (copy `/n/{id}`), Clear session.
- Analytics: page count + time-on-page milestones (sessionStorage).
- Waitroom: when over capacity, a queue screen polls `GET /api/waitroom` (`poll_after_ms`), actions gated on `admitted`.

### 1.5 Live video stream (experimental feature — optional, Phase 5)

WebSocket to a Modal-hosted LTX-2 streaming engine. Client protocol:

```jsonc
// on open:
{ "action": "start", "session_id": "ltx_stream_<uuid>", "prompt": "<motion prompt>",
  "width": ..., "height": ..., "num_frames": 49, "frame_rate": 24,
  "max_segments": 9999, "loopy_mode": true, "loopy_strategy": "anchor_loop",
  "start_image": "data:image/jpeg;base64,..." }
// on page change:
{ "action": "set_target_image", "image": "<dataURL>", "position": 1 }
// teardown:
{ "action": "stop" }
```

Server streams binary fragmented-MP4 chunks; the client parses `moov`/`avcC`/`hvcC` to build the codec string and plays via MediaSource Extensions. Default motion prompt: *"Seamless continuous perfect loop, natural motion, movement, cinematic lighting, high quality, small objects idly animated, people walking, cars driving, boats moving, etc."*

How this produces the demo video's look (verified frame-by-frame on ParisExampleVideo.mp4, 14.4 s @ 30 fps):
- **Idle animation**: while a page is open, LTX-2 loops the page image with subtle motion (boats on the Seine drift, pedestrians walk) — that's `loopy_mode: true` + `loopy_strategy: "anchor_loop"` (loop around an anchor frame so the page never drifts from the source image).
- **Smooth transitions**: on tap, the client sends `set_target_image` with the NEXT page image; the video model generates an interpolation from current → target. Because the clicked object (e.g., Notre-Dame) appears in both images, it visually stays anchored in place while the surrounding layout dissolves/paints in around it. The breadcrumb updates only after the morph completes.
- So the "animated" demo = static image pipeline + video interpolation layer on top; there is no separate animated-page format.

### 1.6 What the original does NOT do: tap-region caching

Verified in the de-minified bundle: there is **no reuse of generated resources for nearby/repeated taps**. Every tap — even at the exact same point — draws a fresh marked image, runs the VLM + prompt author + image gen again, and mints a new node id. The only client caches are keyed by page `localId` (persistence-promise dedup `mn`, transition payloads `q`), never by coordinates, subject, or image hash. Server-side reuse can't be fully ruled out, but the SSE always streams a fresh generation. This is a cost/latency gap we can improve on — see §2.3.

---

## 2. Our open-source architecture

Principles: single repo, TypeScript everywhere, **provider-pluggable** (no hard dependency on one AI vendor), runs locally with just API keys, deployable to any Node host.

```
flipbook/
├─ PLAN.md
├─ package.json               # pnpm workspaces (or npm workspaces)
├─ apps/
│  ├─ web/                    # Vite + React 18 SPA
│  │  └─ src/
│  │     ├─ components/       # BrowserFrame, AddressBar, Breadcrumbs, PageImage,
│  │     │                    # TapRipple, DraftBanner, WaitroomCard, UploadButton
│  │     ├─ hooks/            # useGenerationStream (SSE), useSessionTrail, useTapMarker
│  │     └─ lib/              # sse.ts, tapMarker.ts (canvas), api.ts
│  └─ server/                 # Hono (Node) — API + serves built SPA
│     └─ src/
│        ├─ routes/           # generate.ts (SSE), nodes.ts, imageProxy.ts, waitroom.ts
│        ├─ pipeline/         # orchestrator: author → generate → upscale → persist
│        ├─ providers/
│        │  ├─ llm/           # gemini.ts, anthropic.ts, openai.ts  (prompt author + tap VLM)
│        │  ├─ image/         # fal.ts (nano-banana / FLUX), gemini-image.ts, openai-image.ts
│        │  └─ search/        # tavily.ts, none.ts
│        ├─ storage/          # sqlite (drizzle) for nodes; ./data/images on disk, S3/R2 optional
│        └─ prompts/          # system prompts (see §4)
└─ packages/shared/           # zod schemas: Node, SSE events, request bodies
```

Stack choices (decided — keep it boring):
- **Frontend**: Vite + React + TypeScript, plain CSS (the original's aesthetic: cream background, hand-drawn browser chrome, Comic Neue font).
- **Server**: Hono on Node 20+ (native `fetch`/streams, easy SSE), one process serves API + static SPA.
- **DB**: SQLite via drizzle-orm (`data/flipbook.db`). Postgres optional later.
- **Image storage**: local `data/images/{nodeId}/{variant}.jpg`, served by the server; S3-compatible driver optional via env.
- **Default providers** (all swappable by env). DECIDED 2026-08: the user runs an **Anthropic-compatible** LLM proxy (Anthropic Messages API, NOT OpenAI chat-completions) at `http://localhost:20128/v1` (key in `.env` as `LLM_API_KEY`, never hardcoded) which is the default for ALL text/vision LLM work:
  - Prompt author + tap understanding: `anthropic` provider → the official `@anthropic-ai/sdk` with `new Anthropic({ baseURL, apiKey: LLM_API_KEY })` pointed at the proxy. Note the SDK requests `{baseURL}/v1/messages`, so `LLM_BASE_URL=http://localhost:20128` (no `/v1` suffix) — verify against the proxy at integration time. Models via `PROMPT_AUTHOR_MODEL` / `TAP_VLM_MODEL` (VLM must accept image input — Anthropic image content blocks: `{type:"image", source:{type:"base64", media_type, data}}`). The earlier Gemini-direct adapter stays as an alternative (`LLM_PROVIDER=gemini`).
  - Web search: `SEARCH_PROVIDER=llm` → the same proxy with the Anthropic **server-side web_search tool**. VERIFIED 2026-08 against the live proxy: `web_search_20260209` is *accepted* but silently routes through a rate-limited code-execution sandbox that keeps failing (`too_many_requests`) and falls back to training knowledge while still emitting `server_tool_use` blocks — a false-positive trap. **`web_search_20250305` is the type that actually executes real search on this proxy.** `providers/search/llm.ts` therefore requires an actual `web_search_tool_result` block (URLs, titles, page ages) as evidence before trusting a tool type, and walks older types until it gets one. Do not "simplify" this check away, and do not switch the default back to the newer type without re-verifying evidence blocks. `none` remains the no-key fallback; Tavily optional alternative.
  - Model discovery: `GET {base}/v1/models` (Anthropic Models API shape) — may or may not be implemented by the proxy.
  - Image: DECIDED 2026-08-06 — **BytePlus Ark (ModelArk)**, replacing fal.ai (fal balance exhausted; Ark is cheaper and the user activated "Free Credit Only" mode, i.e. requests are free until per-model quota runs out, then the API errors instead of charging). Provider `ark` using Ark's images API (`POST {ARK_BASE_URL}/api/v3/images/generations`, key `ARK_API_KEY`, endpoint like `https://ark.ap-southeast.bytepluses.com`). Primary model: **`seedream-4-5-251128`** (Seedream 4.5 — strong text rendering, ~$0.03/image when paid; native image-input editing covers our `edit`/tap modes without SeedEdit). Fallback pool: **`seedream-4-0-250828`** (separate free quota — auto-fallback on quota-exhausted errors). Model IDs confirmed by the user from the Ark console 2026-08-06. Draft tier = same model at smaller `size`; final = larger size. Seedance (video) on the same account is the natural engine for Phase 5. Keep the fal provider compiling as an alternative; mock provider remains the no-key fallback (important: with Free Credit Only, quota exhaustion = hard API errors — the pipeline must surface a clear "image quota exhausted" error event, not hang).

### 2.1 API contract (same shape as the original, so behavior matches)

- `POST /api/generate` — SSE; body = the three modes from §1.3 verbatim. Events: `start | tap_subject | tap_icon | preview | draft_complete | draft_error | tap_subject_error | tap_icon_error | complete | error`.
- `GET /api/nodes/:id` → `{ node, history }`; `POST /api/nodes` (persist, with `parent_id`); `POST /api/nodes/upload` (user image as data URL → creates root node, VLM titles it).
- `GET /api/image-proxy?url=` — only needed if images live on another origin; skip in MVP (same-origin storage).
- `GET/POST /api/waitroom` — MVP returns `{ enabled: false, admitted: true }`; real queue is Phase 4.
- `GET /n/:id` — serve SPA with OG meta tags for sharing.

### 2.2 Generation pipeline (server, per request)

```
tap mode only:  [A] VLM(marked image) → { subject, icon_crop }   → emit tap_subject / tap_icon
all modes:      [B] Prompt author LLM (query|subject|edit + parent context + optional web search)
                    → { page_title, authored_prompt }            # detailed visual-layout prompt
                [C] Draft image gen (fast model, draft res)      → emit preview(s), draft_complete
                [D] Final image gen (quality model, full res)    → emit complete
                [E] Persist node + variants (async with retry)
```

- [A] and [B] can overlap: fire the VLM call, stream `tap_subject` as soon as it returns, feed subject into [B].
- [C]/[D]: if the image provider streams partial images, forward them as `preview` events; otherwise emit the draft as a single `preview` then `draft_complete`.
- Generate the requested aspect ratio only; other variants lazily on demand (the original pre-renders all three — do that later, it triples cost).

---

### 2.3 Tap caching & resource reuse (our improvement over the original)

Three cache layers, all optional via config, applied in order on every tap:

1. **Coordinate quantization → VLM cache.** Key = `(node_id, round(x*24), round(y*24))` (~4% grid). On hit, skip the tap-understanding VLM call and reuse the cached `{ subject }`. Nearby clicks on the same object usually land in adjacent cells, so also check the 8 neighboring cells and accept a hit if the cached subject's saved click-point is within a radius ≈ the marker radius (8.5% of min dimension — same as the visual circle, which is honest: anything under the same circle is "the same click").
2. **Subject-level child dedup.** After `subject` resolves (from VLM or cache), normalize it (lowercase, trim, singularize) and look up existing children of `current_node_id` with the same normalized subject. On hit, emit `tap_subject` + a `complete` event carrying the **existing child node** — instant navigation, zero generation cost. Config `tapDedup: "reuse" | "variant" | "off"` (default `reuse`; `variant` regenerates but still reuses the VLM result).
3. **Prompt-hash image cache.** Key = SHA-256 of `(authored_prompt, aspect_ratio, model, tier)`. If the prompt author produces an identical prompt (common for repeated searches of the same query), serve the stored image instead of regenerating.

Storage: layer 1 in a `tap_cache` table (node_id, cell, x, y, subject); layer 2 is just an index on `nodes(parent_id, normalized_subject)` — add a `normalized_subject` column; layer 3 a `prompt_hash` column + unique index on `nodes`.

Trade-off to document: reuse makes repeat exploration deterministic (users revisiting get the same child — arguably better UX and matches "browser" semantics: same link, same page), at the cost of variety. The `variant` mode preserves the original's always-fresh behavior.

## 3. Milestones

### Phase 0 — Scaffold (½ day)
Workspace, Hono server + Vite proxy, drizzle + SQLite migration for `nodes`, `.env.example` (`GEMINI_API_KEY`, `FAL_KEY`, `TAVILY_API_KEY?`, `IMAGE_PROVIDER`, `LLM_PROVIDER`), zod schemas in `packages/shared`. CI: typecheck + lint.

### Phase 1 — MVP: search → image page → tap → new page (2–3 days)
The core loop, single quality tier (draft model only):
1. Server: `POST /api/generate` SSE; modes `search` + `tap`; prompt-author call; fal image call; store node + image; `complete` event.
2. Web: BrowserFrame + AddressBar; submit query → SSE hook → show image; canvas tap-marker util (port §1.3 marker spec exactly); click → ripple + `tap` request; breadcrumb trail with back/forward (linear history, truncate-on-branch like the original: `[...trail.slice(0, current+1), newPage]`).
3. `/n/:id` share links + `{ node, history }` hydration.
**Acceptance**: type "Hà Nội travel overview" → infographic page; click the phở bowl → phở page; breadcrumbs navigate; reload of `/n/:id` restores the trail.

### Phase 2 — Fidelity (2–3 days)
- `edit` mode (typed command on an open page), `tap_subject` early feedback in the address bar, aspect-ratio picker, upload-image root node, web-search toggle wired to the search provider, session `Clear`.
- Progressive `preview` events (fal streaming or draft-then-HQ two-pass).
- OG tags on `/n/:id`, image variants on demand.

### Phase 3 — Two-tier quality + polish (2 days)
- Draft tier (flux/schnell, low res, ~1–2 s) → `draft_complete` with "continue with draft" UI; final tier (nano-banana, full res) swaps in via `complete`; 90 s timeout → keep draft.
- Tap caching & reuse (§2.3): coordinate-grid VLM cache, subject-level child dedup, prompt-hash image cache.
- Landing page with intro copy + example gallery; error toasts; retry/backoff for persistence; page-generated analytics counter (sessionStorage, no external service).

### Phase 4 — Operational hardening (1–2 days, optional for OSS)
- Waitroom with real queue (in-memory token bucket → Redis optional), per-IP rate limits, cost guardrails (max pages/session), S3/R2 storage driver, Dockerfile + fly.io/Render deploy docs.

### Phase 5 — Animated pages (experimental, separate track)
DECIDED 2026-08-06: use **Seedance on BytePlus Ark** (same account as images) — batch i2v, not real-time streaming. Model: **`seedance-1-0-pro-250528`** (Seedance 1.0 Pro — the user's `seedance-1-5-pro-251215` free quota is already exhausted; 1.0 Pro quota remains). Confirmed by the user from the Ark console 2026-08-06: supports text-to-video, first-frame-to-video, AND first-last-frame-to-video — so both idle loops (first-frame) and page-transition morphs (first+last frame) work on this one model. Use 480p/5s during dev (video burns Free Credit quota fast).
- Idle animation: after `complete`, background-generate a loop clip (first frame = page image, motion prompt from §1.5: "Seamless continuous perfect loop... people walking, cars driving, boats moving"), swap in when ready; ping-pong playback to hide the loop seam.
- Transitions: first frame = current page, last frame = next page → morph clip (batch equivalent of the original's `set_target_image`). Too slow to generate at click time — instant CSS crossfade is the always-available fallback; Seedance morphs only for pre-generated page pairs / share videos.
- True real-time streaming like the original (self-hosted LTX-2 on Modal per §1.5 protocol) remains a separate GPU project if ever needed.

---

## 4. Prompt design (server/src/prompts/)

1. **page-author.md** (system): "You are the art director of an infinite visual encyclopedia. Given a topic (and optional parent page + web-search results), output JSON `{ page_title, image_prompt }`. The image_prompt must describe ONE complete self-contained page: title text, layout (panels/labels/callouts), every text string to render verbatim, and a consistent style (clean modern vector illustration, warm palette, cream background). Include 4–8 clearly labeled clickable sub-topics so the user has things to explore. All information must be accurate."
   - The original's `authored_prompt` (§1.2) is the gold standard: title, per-panel layout, exact label strings, footer fact, palette. Match that structure.
2. **tap-subject.md** (VLM): "The image has a red circle marker with crosshairs. Name exactly what is under the marker in ≤4 words. Return JSON `{ subject }`."
3. **edit-author.md**: rewrite parent `authored_prompt` per the user's command, preserving style/layout continuity.
4. Style continuity: pass the parent's `authored_prompt` into child authoring ("keep the same visual style as the parent page").

## 5. Cost & keys (document in README)

- Per page ≈ 1 flash-LLM call (+1 VLM call for taps) + 1–2 image generations. With nano-banana ≈ $0.03–0.05/page HQ; flux/schnell draft ≈ $0.003. Default config = draft-only to keep OSS users' costs low; HQ tier opt-in via env.
- All keys via `.env`; every provider optional except one LLM + one image provider.

## 6. Risks / open questions

- nano-banana text rendering is the moat — flux/schnell drafts will have garbled text; acceptable for draft tier only.
- fal streaming partial previews: verify current API support; else fake progressive with blur-up of the draft.
- The original pre-renders 3 aspect variants per node; we defer to on-demand to cut cost — revisit if share embeds need them.
- Waitroom/abuse: an open deployment burns money fast; ship with rate limits on by default.
