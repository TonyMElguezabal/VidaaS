## Why

magnific.com's video API is being fully replaced by RunningHub's image-to-video API (`rhart-video-g/image-to-video`). A POC confirmed RunningHub accepts our fal.ai image URLs directly, queues concurrent tasks, and returns mp4 results via polling — a cleaner integration than magnific, at ~$0.036/video.

## What Changes

- **BREAKING**: Remove the magnific.com integration entirely (submit call, webhook endpoint, result parsing, `MAGNIFIC_API_KEY`).
- Add RunningHub as the sole video provider:
  - Submit: `POST /openapi/v2/rhart-video-g/image-to-video` with `Bearer` auth, passing the fal.ai image URL in `imageUrls`, `aspectRatio: "16:9"`, `resolution: "720p"`, `duration: 6`.
  - Poll: `POST /openapi/v2/query` with `{ taskId }` until `SUCCESS`/`FAILED`; extract the mp4 URL from `results[]`.
- **Remove the video webhook path** — RunningHub is poll-only. The existing cron reconciler becomes the sole completion path (already built and tested).
- Store the RunningHub `taskId` in the existing `videoTaskId` column (no schema change).
- Add `RUNNINGHUB_API_KEY` secret; retire `MAGNIFIC_API_KEY`.
- **24-hour URL expiry (Option B)**: keep storing RunningHub's raw result URL; update UI copy to "download within 24 hours" instead of the current 2-day wording. No R2 archival in this change.

## Capabilities

### New Capabilities

- (none — this modifies existing behavior)

### Modified Capabilities

- `video-generation`: switch provider from magnific.com to RunningHub; poll-only completion (no webhook); 16:9 / 720p / 6s parameters; result URL valid 24h.
- `content-delivery`: video result URLs now expire in 24 hours; UI communicates this.

## Impact

- **Code**: `src/lib/generation.ts` (rewrite `startVideoGeneration` + `checkVideoStatus`, drop magnific parsing/webhook helpers), `src/index.ts` (delete `/api/webhooks/magnific`, adjust status mapping in `applyVideoResult`), `public/index.html` (expiry copy).
- **Config**: `wrangler.jsonc`/secrets — add `RUNNINGHUB_API_KEY`, remove `MAGNIFIC_API_KEY`.
- **No DB migration** — reuses `videoTaskId`.
- **External**: dependency shifts from magnific.com to RunningHub; `WEBHOOK_BASE_URL` no longer used by video (still used by the fal image webhook).
