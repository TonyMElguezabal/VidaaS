# AGENTS.md — VidaaS

Guidance for AI agents working in this repo. For a full walkthrough (setup,
API, deployment, ngrok), see [README.md](./README.md).

## What this is

VidaaS turns scripted "chunks" into AI images (fal.ai) and short videos
(magnific.com). It is a **single Cloudflare Worker**: `src/index.ts` exports
both a `fetch` handler (Hono HTTP API) and a `queue` handler (background job
consumers). State lives in **Cloudflare D1**; a self-contained static SPA is
served from `public/index.html` (React via htm + Tailwind, no build step).

Per-chunk state machine:
`submitted → image-generating → image-complete → video-generating → complete` (or `failed`).

## Architecture facts to keep in mind

- **One entry point.** `src/index.ts` handles both HTTP and queues. Don't
  reintroduce separate worker files or Durable Objects — the DO was removed on
  purpose (kept simple; 30s staggering is done via queue `delaySeconds`).
- **Mock mode is the default.** When `ENVIRONMENT !== 'production'`, no external
  APIs are called and no credits are spent (`src/lib/generation.ts`). In mock
  mode video "completes" immediately via `completedVideoUrl`; in production it
  completes asynchronously through `POST /api/webhooks/magnific`.
- **Both image and video are async.** Image uses fal's **queue** endpoint
  (`queue.fal.run/...?fal_webhook=`) → `/api/webhooks/fal`. The synchronous
  `fal.run` endpoint times out with a 524 for this slow model — do not use it.
  Video uses magnific + `/api/webhooks/magnific`, with a **cron reconciler**
  (`* * * * *`) polling the magnific GET endpoint as the authoritative fallback.
- **Webhook correlation** uses BOTH `sessionId` and `chunkId` query params
  (chunk IDs are user-supplied and not globally unique). The webhook is
  idempotent — don't remove that guard.
- **Videos are stored as magnific.com URLs** (MVP decision). R2 binding +
  credentials exist but download-to-R2 is not wired yet.
- **D1 database** id is pinned in `wrangler.jsonc`. Migrations are raw SQL files
  in `src/migrations/` applied via `wrangler d1 execute` (not the
  `d1 migrations` framework).

## Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Local dev server (API + SPA) on :8787 |
| `npm run db:migrate:local` | Apply schema to local D1 (run once) |
| `npm run db:migrate:remote` | Apply schema to remote D1 (run once) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run ngrok` | Expose :8787 for real magnific webhooks |
| `npm run queues:create` / `r2:create` | One-time infra for deploy |
| `npm run deploy` | Deploy to Cloudflare (needs Workers Paid plan for Queues) |

Run `wrangler types` after changing bindings in `wrangler.jsonc`.

## Gotchas (learned the hard way)

- **Zod v4**: use `error.issues`, not `error.errors` (the latter is undefined and
  throws inside catch blocks → surprise 500s).
- **`global_fetch_strictly_public`** compat flag is on: the Worker cannot
  `fetch()` localhost. That's why mock mode returns the completed video URL
  directly instead of self-POSTing a webhook.
- **`0002_add_error_column.sql`** is an `ALTER TABLE ADD COLUMN`; it errors if
  run twice (column exists) — safe to ignore on re-run.
- **magnific webhook shape**: the callback is the GET response *minus* the
  `data` wrapper, and `generated` is an array of plain URL **strings** (not
  `{url}` objects). GET status: `GET /v1/ai/image-to-video/kling-v2-5-pro/{task_id}`
  → `{ data: { status, generated: ["<mp4 url>"] } }`. `parseMagnificResult`
  tolerates both shapes.
- **Cloudflare Queues require the Workers Paid plan** — `wrangler deploy` fails
  otherwise.
- After editing `wrangler.jsonc` bindings, regenerate types and restart `dev`.

## Conventions

- Keep it simple: no service classes, events, or policies (MVP directive).
- New HTTP routes go in the Hono app in `src/index.ts`; new background work goes
  through the queue consumers in the same file.
- Parsing/validation lives in `src/lib/chunk-parser.ts` (Zod). External API
  calls live in `src/lib/generation.ts` and must stay mock-aware.

---

## Cloudflare platform reference

Your knowledge of Cloudflare APIs and limits may be outdated. Retrieve current
docs before non-trivial Workers / D1 / Queues / R2 / Durable Objects work.

- Workers: https://developers.cloudflare.com/workers/
- Limits: the product's `/platform/limits/` page (e.g. `/workers/platform/limits`, `/queues/platform/limits`)
- D1: `/d1/` · Queues: `/queues/` · R2: `/r2/`
- Errors: https://developers.cloudflare.com/workers/observability/errors/
- MCP: `https://docs.mcp.cloudflare.com/mcp`
