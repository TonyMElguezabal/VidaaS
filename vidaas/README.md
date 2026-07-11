# VidaaS — AI Image & Video Generation

Turn a scripted list of "chunks" into AI-generated images and short videos.
Each chunk describes a scene; the app generates an image (fal.ai), then animates
it into a video (RunningHub), tracking progress in real time.

Built as a **single Cloudflare Worker**: a Hono HTTP API + queue consumers, a D1
database for state, and a self-contained static SPA served from `public/`.

---

## Architecture

```
Browser (public/index.html — React via htm + Tailwind, no build)
   │  POST /api/chunks           GET /api/status (poll 2s)      POST /api/retry
   ▼
┌─────────────────────────── Cloudflare Worker (src/index.ts) ───────────────────────────┐
│  fetch (Hono)                          queue consumers                                   │
│   • /api/chunks  → parse+validate      • image-generation → fal queue → /api/webhooks/fal│
│      → D1 insert → enqueue (30s stagger)   → store imageUrl → enqueue video              │
│   • /api/status  → read D1             • video-generation → startVideoGeneration()       │
│   • /api/retry   → re-enqueue              → RunningHub submit, store taskId             │
│   • /api/webhooks/fal ◄──── fal image done                                               │
│   • scheduled (cron 1m) ──→ poll RunningHub /query for video-generating chunks → complete│
└──────────────────────────────────────────────────────────────────────────────────────────┘
   │ D1 (sessions, chunks, tasks)      │ Queues (image-generation, video-generation)
```

Per-chunk state machine:

```
submitted → image-generating → image-complete → video-generating → complete
                                                                  ↘ failed (after 3 retries)
```

### Tech stack
- **Cloudflare Workers** (single entry: HTTP + queue handlers)
- **Hono** — HTTP routing
- **Cloudflare D1** — serverless SQLite state
- **Cloudflare Queues** — staggered, retryable background jobs
- **fal.ai** Seedream v5 Pro — text→image (16:9, 1920×1080; async queue + webhook)
- **RunningHub** `rhart-video-g/image-to-video` — image→video (16:9, 720p, 6s; poll-only)
- **React (htm) + Tailwind** via CDN — no frontend build step

---

## Prerequisites
- Node.js 18+
- A Cloudflare account (`wrangler login`)
- For deployment: **Workers Paid plan** (Cloudflare Queues requires it)
- API keys: fal.ai, RunningHub

---

## Setup

```bash
npm install
cp .env.example .env.local   # fill in your keys (used for local dev)
```

### Environment variables

Local dev reads `.env.local`. In production these are set as Worker **secrets**
(sensitive) or **vars** (non-sensitive) — see Deployment.

| Name | Type | Purpose |
|------|------|---------|
| `ENVIRONMENT` | var | `development` uses mocks; `production` calls real APIs |
| `WEBHOOK_BASE_URL` | var | Public base URL fal.ai calls back to for image completion (ngrok or deployed URL) |
| `FAL_API_KEY` | secret | fal.ai key in `key:secret` form |
| `RUNNINGHUB_API_KEY` | secret | RunningHub key (`Authorization: Bearer`) |

> **Mock mode**: whenever `ENVIRONMENT !== production`, no external APIs are
> called and no credits are spent — image/video URLs are fabricated so the full
> pipeline runs locally.

---

## Local development

```bash
# 1. Apply the D1 schema to the local database (run once)
npm run db:migrate:local

# 2. Start the dev server (serves API + SPA on http://localhost:8787)
npm run dev
```

Open http://localhost:8787, paste chunks (an example is prefilled), and click
**Generate**. In mock mode the pipeline completes in a couple of seconds.

Useful checks:
```bash
npm run typecheck        # tsc --noEmit
curl localhost:8787/health
```

### Chunk input format

Chunks are separated by an em dash (`—`). Each has four fields:

```
—
ID: 1
PROMPT: "The original line of script for this scene."
IMAGE: Detailed instruction describing the still image to generate.
VIDEO: Instruction for how the image should move/animate.
—
ID: 2
PROMPT: "..."
IMAGE: ...
VIDEO: ...
—
```

Validation rejects: missing fields, empty fields, and duplicate IDs (HTTP 400
with per-chunk details).

---

## API reference

| Method | Path | Body / Query | Description |
|--------|------|--------------|-------------|
| POST | `/api/chunks` | `{ "chunks": "<raw text>" }` | Parse+validate, create session, enqueue image jobs (30s stagger). Returns `sessionId`, `expiresAt`, parsed chunks. |
| GET | `/api/status` | `?sessionId=<id>` | Current session + all chunk states (status, imageUrl, videoUrl, error). |
| POST | `/api/retry` | `{ "sessionId", "chunkId" }` | Reset a chunk and re-enqueue it. |
| POST | `/api/webhooks/fal` | `?sessionId=&chunkId=` + fal payload | Image-completion callback (fal async queue). Idempotent. |
| GET | `/health` | — | `{ "status": "ok" }` |

Video completion has no webhook — RunningHub is poll-only, reconciled by the
cron trigger (`scheduled`, every minute) via `POST /openapi/v2/query`.

---

## Webhook testing with ngrok (local, real fal.ai)

Only **image** completion uses a webhook (fal.ai's async queue calls
`/api/webhooks/fal`). Video is poll-only, so it needs no public URL. For local
real-API testing, fal must reach your machine — expose the dev server with
[ngrok](https://ngrok.com/download):

```bash
# Install once (macOS): brew install ngrok  — then add your authtoken
# Terminal 1:
npm run dev
# Terminal 2:
npm run ngrok            # → forwards https://<random>.ngrok-free.app → localhost:8787
```

Point the app at the tunnel and enable real APIs, then restart `npm run dev`:

```jsonc
// wrangler.jsonc → vars
"WEBHOOK_BASE_URL": "https://<random>.ngrok-free.app",
"ENVIRONMENT": "production"
```

Now `POST /api/chunks` → real fal.ai image (fal calls
`https://<random>.ngrok-free.app/api/webhooks/fal?...`) → RunningHub video →
cron polls RunningHub → chunk marked complete. (The ngrok URL changes each
restart on the free plan — update `WEBHOOK_BASE_URL` accordingly.)

> Real API calls spend fal.ai and RunningHub credits.

---

## Deployment (Cloudflare)

Requires the **Workers Paid plan** (for Queues). One-time infrastructure:

```bash
wrangler login

# D1 already created (id in wrangler.jsonc). Apply schema to the REMOTE db:
npm run db:migrate:remote        # run once; the 0002 ALTER errors if re-run

# Create the queues:
npm run queues:create

# Set secrets (prompted for each value):
wrangler secret put FAL_API_KEY
wrangler secret put RUNNINGHUB_API_KEY
```

Set `WEBHOOK_BASE_URL` in `wrangler.jsonc` to your deployed Worker URL
(e.g. `https://vidaas.<subdomain>.workers.dev`) and `ENVIRONMENT` to
`production`, then:

```bash
npm run deploy
```

The deployed Worker URL is public, so no ngrok is needed in production —
fal.ai calls the Worker's own `/api/webhooks/fal` directly, and the cron
trigger polls RunningHub for video results.

---

## Project structure

```
vidaas/
├── public/
│   └── index.html          # Static SPA (React via htm + Tailwind, no build)
├── src/
│   ├── index.ts            # Worker entry: Hono fetch + queue consumers
│   ├── lib/
│   │   ├── chunk-parser.ts # Parse + validate the "—/ID/PROMPT/IMAGE/VIDEO" format
│   │   ├── generation.ts   # fal.ai + RunningHub calls (mock-aware)
│   │   └── mocks.ts        # Mock API responses for local dev
│   ├── types/index.ts      # Shared types
│   └── migrations/
│       ├── 0001_init.sql   # sessions, chunks, tasks, queue_jobs + indexes
│       ├── 0002_add_error_column.sql
│       └── 0003_add_video_task_id.sql
├── wrangler.jsonc          # Bindings: D1, Queues, R2, vars, prod env
├── .env.example            # Template for local secrets
└── package.json
```

---

## Design notes & current limitations
- **Both providers are async.** fal.ai (image) uses its async **queue** endpoint
  with a webhook → `/api/webhooks/fal`. RunningHub (video) is **poll-only** —
  submit returns a `taskId`, and the cron trigger polls `POST /openapi/v2/query`
  every minute until `SUCCESS`.
- **Videos are stored as RunningHub URLs**, which **expire 24 hours** after
  generation. The UI warns users to download within 24h. Re-hosting to R2 is
  deferred (Option B).
- **Grabbing media URLs**: under each image/video preview the UI shows a
  "Copy URL" button and an "Open ↗" link; right-clicking an image also copies
  its URL. Copy uses the Clipboard API (with an `execCommand` fallback) and a
  transient toast. The image URL is the persistent fal.ai CDN URL.
- **Video params**: `aspectRatio 16:9`, `resolution 720p`. `duration` is
  **computed from the spoken PROMPT** (not the VIDEO/motion prompt) via a
  speaking-rate model — `clamp(round(words / 2.5), 6, 30)` — so a clip lasts
  about as long as its line takes to narrate.
- **Sessions live in D1** and are referenced from `localStorage` (URLs/refs
  only, never binary content) with a 2-day TTL and auto-resume on reload.
- **Retries**: queue jobs retry up to 3 times (same chunk ID); after that the
  chunk is marked `failed` and can be retried manually from the UI.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| `Internal server error` on submit | D1 not migrated — run `npm run db:migrate:local`. |
| Chunk stuck at `submitted` | It's staggered (30s per chunk index) or the queue consumer isn't running — check `npm run dev` output. |
| Image never completes (real mode) | `WEBHOOK_BASE_URL` not publicly reachable for fal's callback — use ngrok or the deployed URL. |
| Video never completes (real mode) | Cron poller issue or bad `RUNNINGHUB_API_KEY` — check `wrangler tail` for `/query` errors. |
| `wrangler deploy` fails on queues | Needs the Workers Paid plan. |
| `0002` migration errors on re-run | The `error` column already exists — safe to ignore. |
| Images don't preview | fal.ai CDN URL blocked/expired, or still generating. |
