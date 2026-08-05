# flipbook

Open-source clone of [flipbook.page](https://flipbook.page) — an infinite visual browser generated entirely on
demand. Every page is a single AI-generated image; clicking anything in the image generates a new image exploring
that thing in more depth.

See `PLAN.md` for the full reverse-engineering notes and architecture. This repo currently implements **Phase 0
through Phase 3** (scaffold, core loop, fidelity, caching + polish). Phase 3 dropped the original's two-tier
draft/final quality (see PLAN §3) in favor of tap caching and reuse — see PLAN §2.3.

## Quickstart

```bash
npm install
cp .env.example .env   # then add API keys, see below
npm run dev:server     # http://localhost:8787
npm run dev:web        # http://localhost:5173 (proxies /api and /images to the server)
```

Open http://localhost:5173, type a query (e.g. "Hà Nội travel overview"), and click anywhere in the generated
image to explore deeper.

## API keys

| Env var | Used for | Without it |
|---|---|---|
| `LLM_API_KEY` (+ `LLM_BASE_URL`) | prompt authoring, tap-subject vision, and web search via an Anthropic-compatible proxy | falls back to a deterministic mock LLM |
| `GEMINI_API_KEY` | alternative LLM provider (`LLM_PROVIDER=gemini`) | falls back to a deterministic mock LLM |
| `ARK_API_KEY` (+ `ARK_BASE_URL`) | image generation via BytePlus Ark (`IMAGE_PROVIDER=ark`, default) | falls back to a deterministic solid-color placeholder image |
| `FAL_KEY` | alternative image provider (`IMAGE_PROVIDER=fal`) | falls back to a deterministic solid-color placeholder image |

The server logs which keys are missing on startup and runs on mock providers for whatever's absent — it never
blocks.

## What's implemented (Phase 0–3)

- `POST /api/generate` — SSE, `search` / `tap` / `edit` modes (`start` / `tap_subject` / `preview` / `complete` / `error`)
- `POST /api/nodes`, `GET /api/nodes/:id` → `{ node, history }`, `GET /api/nodes` (gallery listing), `POST /api/nodes/upload`
- Web: browser-chrome UI, breadcrumb trail (linear, truncate-on-branch), canvas tap-marker (exact spec in
  PLAN §1.3), `/n/:id` share links with OG tags, aspect-ratio picker, web-search toggle, upload-image entry point,
  session Clear
- **Tap caching & reuse** (PLAN §2.3): coordinate-quantization VLM cache, subject-level child dedup (instant
  navigation on a repeat tap), and a prompt-hash image cache — configurable via `TAP_DEDUP=reuse|variant|off`
  (default `reuse`)
- Landing page with an example gallery built from already-generated nodes (falls back to suggested queries on an
  empty DB), error toasts with a Retry affordance, persistence retry/backoff, and a page-generated analytics
  counter (sessionStorage)

## Not yet implemented

Waitroom, live video streaming — see `PLAN.md` §3 Phase 4/5 for the remaining roadmap.

## Storage

SQLite via Node's built-in `node:sqlite` (no native build step — `better-sqlite3` needs Visual Studio Build Tools,
which aren't assumed to be present). Generated images are stored on disk under `apps/server/data/images/` and
served same-origin so the canvas tap-marker trick never hits a CORS wall.
