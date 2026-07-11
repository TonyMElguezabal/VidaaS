## Context

Images use fal's async queue + webhook (`/api/webhooks/fal`); the queue consumer submits and acks, so completion depends solely on the webhook. A dropped webhook strands the chunk in `image-generating` (observed live). Video already has a cron reconciler (`reconcileVideos`); this adds the image equivalent.

## Goals / Non-Goals

**Goals:**
- Self-heal dropped fal image webhooks by polling fal for the result.
- Mirror the video reconciler's structure and idempotency.
- Add no generation cost (recover the image fal already produced).

**Non-Goals:**
- Replacing the webhook (it stays the fast path).
- Auto-failing genuinely-failed fal images from the poll (kept conservative; the UI's 20-min timeout + manual retry covers that edge).

## Decisions

### Decision 1: Persist fal `request_id`, poll by constructed URL
Store `request_id` in a new `imageTaskId` column. Poll `https://queue.fal.run/bytedance/seedream/requests/{request_id}` (the requests base confirmed in the earlier fal POC) with `Authorization: Key`. A done request returns `{ images: [{ url }] }`; an in-progress one returns `{ detail: "…in progress", … }`.

**Alternative considered:** capture the submit's `response_url` and store that (no hardcoded base). Deferred — `request_id` is always present and the constructed URL is POC-verified; revisit if fal changes the path.

### Decision 2: Grace period ~90s
The reconciler only polls chunks whose `updatedAt` is older than ~90s (`datetime('now','-90 seconds')`), giving the webhook first crack and avoiding needless fal polls for freshly-submitted chunks.

### Decision 3: Shared, idempotent `applyImageResult`
Extract image completion (set `imageUrl` + `image-complete` + enqueue video) into one helper, guarded by `WHERE … AND imageUrl IS NULL`. It enqueues the video job only if the UPDATE actually transitioned the row (D1 `meta.changes > 0`), so a webhook/cron race enqueues video at most once. Both the webhook and the reconciler call it.

### Decision 4: Conservative on failure
The poll only *recovers successes*: image URL → complete; otherwise treat as pending (retry next cron). It does not mark chunks failed, avoiding false negatives. Truly-failed images with a dropped webhook remain visible via the UI's 20-minute timeout banner + manual retry.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| Hardcoded fal requests base path could drift | POC-verified; single constant; easy fix. Response_url capture is the fallback plan. |
| Reconciler races the webhook | `imageUrl IS NULL` guard + `meta.changes` check → exactly-once video enqueue. |
| Genuinely-failed image never auto-fails | Conservative by design; UI timeout + manual retry handle it. |

## Migration

`0004_add_image_task_id.sql`: `ALTER TABLE chunks ADD COLUMN imageTaskId TEXT;`
