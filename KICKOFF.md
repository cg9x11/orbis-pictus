# Kickoff prompt (paste into a new session)

Read PLAN.md in this directory (E:\code\flipbook) fully before writing any code. It contains the reverse-engineered spec of flipbook.page (API contract, SSE events, tap-marker spec, node schema) and the agreed architecture — treat it as the source of truth; do not re-derive or change decisions already made there.

Implement Phase 0 and Phase 1 in this session:

1. Phase 0 — scaffold: npm workspaces monorepo (`apps/web` Vite+React+TS, `apps/server` Hono+TS, `packages/shared` zod schemas), drizzle + SQLite `nodes` table, `.env.example`, git init + sensible .gitignore.
2. Phase 1 — the core loop, single quality tier:
   - `POST /api/generate` (SSE) with modes `search` and `tap` per PLAN §1.3/§2.1–2.2 (events: start, tap_subject, preview, complete, error are enough for now; draft/HQ split is Phase 3).
   - Providers behind interfaces from day one (PLAN §2): prompt author + tap VLM = Gemini flash via `GEMINI_API_KEY`; image = fal.ai via `FAL_KEY` (use `fal-ai/flux/schnell` as default so testing is cheap; `nano-banana` selectable via `IMAGE_MODEL` env). Web search: stub interface, `none` provider only for now.
   - Prompts in `apps/server/src/prompts/` following PLAN §4.
   - Web: BrowserFrame + AddressBar + breadcrumb trail (linear history, truncate-on-branch), page image view, canvas tap-marker exactly per PLAN §1.3 (red #ff3b30 circle r≈8.5% min-dim, white halo + crosshair, JPEG 0.92), SSE client hook, tap ripple can be a simple CSS animation.
   - Persistence + share: `POST /api/nodes`, `GET /api/nodes/:id` → `{node, history}`, `/n/:id` route hydrates the trail.

Working agreements:
- TypeScript strict; zod-validate every API boundary using `packages/shared`.
- Small commits per milestone (scaffold / server pipeline / web UI / persistence), each leaving the repo in a working state.
- Verify as you go: typecheck + a curl test of the SSE endpoint with a mocked provider before wiring real keys; then one real end-to-end test ("Hà Nội travel overview" → page renders → click something → child page).
- If a real API key is missing from .env, build everything against a mock provider (deterministic placeholder image + canned LLM JSON) and tell me exactly which keys to add; do not block.
- Do not implement: edit mode, upload, aspect-ratio picker, waitroom, video streaming, tap caching (§2.3) — later phases.

Acceptance for this session = Phase 1 acceptance criteria in PLAN §3.
