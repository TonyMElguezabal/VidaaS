## 1. Video provider integration (src/lib/generation.ts)

- [x] 1.1 Rewrite `startVideoGeneration` to POST `/openapi/v2/rhart-video-g/image-to-video` with `Bearer` auth and body `{ prompt, aspectRatio:"16:9", imageUrls:[imageUrl], resolution:"720p", duration:6 }`; return the `taskId`
- [x] 1.2 Rewrite `checkVideoStatus` to POST `/openapi/v2/query` with `{ taskId }` and `Bearer` auth; return `{ status, videoUrl }` where videoUrl = result with `outputType==="mp4"` (fallback first)
- [x] 1.3 Remove magnific-specific helpers: `buildMagnificWebhookUrl`, `parseMagnificResult`, `MagnificResponse` usage
- [x] 1.4 Keep mock mode returning a `completedVideoUrl` so local dev still completes
- [x] 1.5 Replace `MAGNIFIC_API_KEY` with `RUNNINGHUB_API_KEY` in `GenerationEnv`

## 2. Worker wiring (src/index.ts)

- [x] 2.1 Delete the `POST /api/webhooks/magnific` route
- [x] 2.2 Update `applyVideoResult` status mapping: `SUCCESS → complete`, `FAILED → failed`, `QUEUED`/`RUNNING → pending`
- [x] 2.3 Update `Env` type: add `RUNNINGHUB_API_KEY`, remove `MAGNIFIC_API_KEY`
- [x] 2.4 Remove `parseMagnificResult` import; confirm cron `reconcileVideos` still drives completion

## 3. Config & secrets

- [x] 3.1 `wrangler secret put RUNNINGHUB_API_KEY` (and update `.env.local` / `.env.example`)
- [x] 3.2 Remove `MAGNIFIC_API_KEY` secret/env references after deploy
- [x] 3.3 Note in wrangler.jsonc that `WEBHOOK_BASE_URL` is now used only by the fal image webhook

## 4. UI copy (public/index.html)

- [x] 4.1 Change the link-expiry line from 2-day wording to "Video links expire within 24 hours — download anything you want to keep"

## 5. Verify

- [x] 5.1 Mock mode: submit a chunk locally, confirm it reaches `complete` with a mock video URL
- [x] 5.2 Production: deploy, submit one chunk, confirm image → RunningHub submit → cron poll → `complete` with a real mp4 URL
- [x] 5.3 Confirm no lingering magnific references (`grep -ri magnific src`)
- [x] 5.4 `tsc --noEmit` clean

## 6. Docs

- [x] 6.1 Update README (provider, endpoints, 24h expiry, RUNNINGHUB_API_KEY) and AGENTS.md gotchas (poll-only, status mapping, results[] shape)
