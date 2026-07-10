# VidaaS — AI Image & Video Generation

Turn a scripted list of "chunks" into AI-generated images and short videos.
Each chunk describes a scene; the app generates an image (fal.ai), then animates
it into a video (magnific.com), tracking progress in real time.

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
│   • /api/chunks  → parse+validate      • image-generation → generateImage() → fal.ai     │
│      → D1 insert → enqueue (30s stagger)   → store imageUrl → enqueue video              │
│   • /api/status  → read D1             • video-generation → startVideoGeneration()       │
│   • /api/retry   → re-enqueue              → magnific.com (webhook_url=…?sessionId&chunkId)│
│   • /api/webhooks/magnific ◄──────────────── magnific.com calls back with the video URL  │
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
- **fal.ai** Seedream v5 Pro — text→image (16:9, 1920×1080)
- **magnific.com** kling-v2.5-pro — image→video (async via webhook)
- **React (htm) + Tailwind** via CDN — no frontend build step

---

## Prerequisites
- Node.js 18+
- A Cloudflare account (`wrangler login`)
- For deployment: **Workers Paid plan** (Cloudflare Queues requires it)
- API keys: fal.ai, magnific.com; R2 credentials (for future video archival)

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
| `WEBHOOK_BASE_URL` | var | Public base URL magnific.com calls back to (ngrok or deployed URL) |
| `FAL_API_KEY` | secret | fal.ai key in `key:secret` form |
| `MAGNIFIC_API_KEY` | secret | magnific.com `x-magnific-api-key` |
| `R2_ACCESS_KEY_ID` | secret | R2 S3 access key (reserved for video archival) |
| `R2_SECRET_ACCESS_KEY` | secret | R2 S3 secret |

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
| POST | `/api/webhooks/magnific` | `?sessionId=&chunkId=` + magnific payload | Video-completion callback. Idempotent. |
| GET | `/health` | — | `{ "status": "ok" }` |

---

## Webhook testing with ngrok (local, real magnific.com)

magnific.com must reach your machine to deliver the finished video. Expose the
local dev server with [ngrok](https://ngrok.com/download):

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

Now `POST /api/chunks` → real fal.ai image → real magnific.com video → magnific
calls `https://<random>.ngrok-free.app/api/webhooks/magnific?...` → chunk marked
complete. (The ngrok URL changes each restart on the free plan — update
`WEBHOOK_BASE_URL` accordingly.)

> Real API calls spend fal.ai and magnific.com credits.

---

## Deployment (Cloudflare)

Requires the **Workers Paid plan** (for Queues). One-time infrastructure:

```bash
wrangler login

# D1 already created (id in wrangler.jsonc). Apply schema to the REMOTE db:
npm run db:migrate:remote        # run once; the 0002 ALTER errors if re-run

# Create the queues and the R2 bucket:
npm run queues:create
npm run r2:create

# Set secrets (prompted for each value):
wrangler secret put FAL_API_KEY
wrangler secret put MAGNIFIC_API_KEY
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
```

Set `WEBHOOK_BASE_URL` in `wrangler.jsonc` to your deployed Worker URL
(e.g. `https://vidaas.<subdomain>.workers.dev`) and `ENVIRONMENT` to
`production`, then:

```bash
npm run deploy
```

The deployed Worker URL is public, so no ngrok is needed in production —
magnific.com calls the Worker's own `/api/webhooks/magnific` directly.

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
│   │   ├── generation.ts   # fal.ai + magnific.com calls (mock-aware)
│   │   └── mocks.ts        # Mock API responses for local dev
│   ├── types/index.ts      # Shared types
│   └── migrations/
│       ├── 0001_init.sql   # sessions, chunks, tasks, queue_jobs + indexes
│       └── 0002_add_error_column.sql
├── wrangler.jsonc          # Bindings: D1, Queues, R2, vars, prod env
├── .env.example            # Template for local secrets
└── package.json
```

---

## Design notes & current limitations
- **Image generation is synchronous** on fal.ai's side (returns the URL
  immediately); only **video** generation is truly async and uses webhooks.
- **Videos are stored as magnific.com URLs** (per the MVP decision). These are
  temporary — the UI notes an expiry and links persist ~2 days. Downloading to
  R2 is scaffolded (binding + credentials present) but not yet wired.
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
| Video never completes (real mode) | `WEBHOOK_BASE_URL` not publicly reachable — use ngrok or the deployed URL. |
| `wrangler deploy` fails on queues | Needs the Workers Paid plan. |
| `0002` migration errors on re-run | The `error` column already exists — safe to ignore. |
| Images don't preview | fal.ai CDN URL blocked/expired, or still generating. |
