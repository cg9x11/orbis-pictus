# flipbook

Open-source clone of [flipbook.page](https://flipbook.page) — an infinite visual browser generated entirely on
demand. Every page is a single AI-generated image; clicking anything in the image generates a new image exploring
that thing in more depth.

See `PLAN.md` for the full reverse-engineering notes and architecture. This repo currently implements **Phase 0
(scaffold)** and **Phase 1 (core loop, single quality tier)**.

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
| `GEMINI_API_KEY` | prompt authoring + tap-subject vision (`gemini-2.0-flash`) | falls back to a deterministic mock LLM |
| `FAL_KEY` | image generation (`fal-ai/flux/schnell` by default; set `IMAGE_MODEL=fal-ai/nano-banana` for quality) | falls back to a deterministic solid-color placeholder image |

The server logs which keys are missing on startup and runs on mock providers for whatever's absent — it never
blocks. `SEARCH_PROVIDER` is a stub (`none`) in Phase 1; web search isn't implemented yet.

## What's implemented (Phase 1)

- `POST /api/generate` — SSE, `search` and `tap` modes (`start` / `tap_subject` / `preview` / `complete` / `error`)
- `POST /api/nodes`, `GET /api/nodes/:id` → `{ node, history }`
- Web: browser-chrome UI, breadcrumb trail (linear, truncate-on-branch), canvas tap-marker (exact spec in
  PLAN §1.3), `/n/:id` share links that hydrate the full trail

## Not yet implemented

Edit mode, upload, aspect-ratio picker, waitroom, video streaming, tap caching, two-tier draft/HQ quality, web
search — see `PLAN.md` §3 for the phased roadmap.

## Storage

SQLite via Node's built-in `node:sqlite` (no native build step — `better-sqlite3` needs Visual Studio Build Tools,
which aren't assumed to be present). Generated images are stored on disk under `apps/server/data/images/` and
served same-origin so the canvas tap-marker trick never hits a CORS wall.
