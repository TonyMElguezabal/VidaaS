## Context

The video provider is being swapped from magnific.com to RunningHub. A curl POC validated the full flow: fal.ai image URLs are accepted directly, concurrent submits queue server-side (no rejection), and the mp4 is returned via polling `/query` in ~15–60s at ~$0.036/video. The existing `videoTaskId` column and cron reconciler carry over; the change is contained to two files plus UI copy.

## Goals / Non-Goals

**Goals:**
- Replace magnific.com entirely with RunningHub for image-to-video.
- Reuse the existing task-id + cron-reconciler completion machinery.
- Keep the change minimal: no DB migration, no new pipeline steps.

**Non-Goals:**
- R2 archival of videos (Option A) — deferred; we accept the 24h URL expiry.
- Keeping magnific as a switchable provider — it is fully removed.
- Changing the image (fal.ai) path or the queue/state machine.

## Decisions

### Decision 1: Poll-only completion (delete the video webhook)
RunningHub exposes no webhook. The cron reconciler (`* * * * *`) already polls `video-generating` chunks with a stored `videoTaskId`; it becomes the sole completion path. `POST /api/webhooks/magnific` and all magnific webhook parsing are deleted.

**Rationale:** The cron path is already built and tested; removing the webhook simplifies the code and eliminates the data-less-payload class of bug we hit with magnific.

**Trade-off:** Up to ~60s of latency between video completion and the chunk flipping to `complete`. Acceptable for minutes-long generation.

### Decision 2: Pass the fal.ai image URL directly
POC confirmed `imageUrls` accepts public URLs, so we pass the stored fal.ai CDN URL — no upload, no R2 round-trip.

### Decision 3: Fixed parameters 16:9 / 720p / 6s
Our images are 16:9 (1920×1080). We send `aspectRatio: "16:9"`, `resolution: "720p"` (per the user's 720p requirement), and `duration: 6` (RunningHub's minimum; range 6–30). VIDEO prompts that mention shorter durations are prose only and do not change the parameter.

### Decision 4: Reuse `videoTaskId`; map RunningHub statuses
Store RunningHub's `taskId` in the existing `videoTaskId` column. In `applyVideoResult`, map `SUCCESS → complete`, `FAILED → failed`, `QUEUED`/`RUNNING → pending`. Result URL = the `results[]` entry with `outputType === "mp4"` (fallback to the first entry).

### Decision 5: Option B for the 24h expiry
Store RunningHub's raw result URL unchanged; update the UI to say video links expire within 24 hours. No re-hosting.

**Alternative considered (Decision A — R2 archival):** download the mp4 and upload to R2 for durable links. Rejected for this change: R2 isn't enabled on the account and it adds a pipeline step; revisit if persistence becomes a requirement.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| 24h URL expiry → stale links for returning users | UI clearly states "download within 24h"; localStorage still resumes the session but a link may be dead. R2 archival remains the future fix. |
| RunningHub concurrency cap unknown at scale | POC showed 2 concurrent submits queue fine (`QUEUED`). Queue retry + 30s stagger absorb transient "queue full" errors if they appear; watch `errorCode`. |
| RunningHub result URL host/region latency (Tencent COS HK) | Playback is client-side; acceptable. |
| Secret migration | Add `RUNNINGHUB_API_KEY` via `wrangler secret put`; the old `MAGNIFIC_API_KEY` can be deleted after deploy. |

## Confirmed API contract (from POC)

```
SUBMIT  POST https://www.runninghub.ai/openapi/v2/rhart-video-g/image-to-video
        Authorization: Bearer <key>
        { prompt, aspectRatio:"16:9", imageUrls:[<falUrl>], resolution:"720p", duration:6 }
   ←    { taskId, status:"QUEUED", errorCode, errorMessage, results:null }

POLL    POST https://www.runninghub.ai/openapi/v2/query
        Authorization: Bearer <key>
        { taskId }
   ←    { status:"SUCCESS", results:[{ url:"…mp4", outputType:"mp4", text:null }] }
        status ∈ QUEUED | RUNNING | SUCCESS | FAILED
```

## Open Questions

1. RunningHub account concurrency/rate limits at higher volume (POC only tested 2). Monitor `errorCode` in production.
2. Whether `duration`/`aspectRatio` should later be derived per-chunk rather than fixed.
