## Why

Image completion depends entirely on fal.ai's webhook reaching us. If that webhook is dropped, the chunk stalls in `image-generating` forever with no recovery — we observed this live (a chunk stuck 13+ minutes). Video generation already has a cron reconciler as a safety net; image generation does not. This closes that asymmetry.

## What Changes

- Persist the fal.ai `request_id` for each in-flight image (new `imageTaskId` column).
- Add a cron reconciler (`reconcileImages`) that, for chunks stuck in `image-generating` past a short grace period, polls fal for the result by request id and completes them — recovering the already-generated image at no extra cost.
- The fal webhook remains the fast path; the reconciler is the authoritative fallback (mirrors the video design).
- Refactor image completion (store URL → `image-complete` → enqueue video) into one shared, idempotent helper used by both the webhook and the reconciler, so a webhook/cron race can't double-enqueue video.

## Capabilities

### Modified Capabilities
- `async-orchestration`: image completion gains a poll-based safety net; a dropped fal webhook self-heals via cron.
- `image-generation`: the fal `request_id` is persisted to enable polling.

## Impact

- **Code**: `src/lib/generation.ts` — add `checkImageStatus(requestId)` (GET `queue.fal.run/…/requests/{id}`). `src/index.ts` — persist `imageTaskId` on submit; add `reconcileImages`; call it from `scheduled`; extract shared `applyImageResult`.
- **DB**: migration `0004` adds `chunks.imageTaskId TEXT`.
- **Cost**: none added — polling recovers an image fal already produced (no re-generation).
- **Grace period**: reconciler only polls chunks whose `updatedAt` is older than ~90s, giving the webhook first crack and avoiding needless fal polls.
