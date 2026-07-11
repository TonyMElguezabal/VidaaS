## 1. Schema

- [x] 1.1 Add migration `0004_add_image_task_id.sql`: `ALTER TABLE chunks ADD COLUMN imageTaskId TEXT;`
- [x] 1.2 Apply to local + remote D1; update `db:migrate:*` scripts to include 0004

## 2. fal status polling (src/lib/generation.ts)

- [x] 2.1 Add `FAL_REQUESTS_BASE = 'https://queue.fal.run/bytedance/seedream/requests'`
- [x] 2.2 Add `checkImageStatus(requestId, env): Promise<{ url?: string; pending?: boolean }>` — GET the requests URL with `Authorization: Key`; images[0].url → `{ url }`, else `{ pending: true }`; throw on HTTP error

## 3. Worker wiring (src/index.ts)

- [x] 3.1 `handleImageJob` (production branch): persist `imageTaskId = result.requestId`
- [x] 3.2 Extract `applyImageResult(env, sessionId, chunkId, url)` — idempotent UPDATE `WHERE imageUrl IS NULL`; enqueue video only if `meta.changes > 0`
- [x] 3.3 Route the fal webhook's success path through `applyImageResult`
- [x] 3.4 Add `reconcileImages(env)`: select `image-generating` chunks with `imageTaskId` and `updatedAt < datetime('now','-90 seconds')`; for each, `checkImageStatus` → on url call `applyImageResult`; log; skip on pending
- [x] 3.5 `scheduled`: run both `reconcileVideos` and `reconcileImages` (via `waitUntil`)

## 4. Verify

- [x] 4.1 `tsc --noEmit` clean
- [x] 4.2 Mock mode: pipeline still completes (mock images never enter the reconciler path)
- [ ] 4.3 Production: confirm a normal chunk completes via webhook (fast path unaffected)
- [ ] 4.4 Production: confirm the currently-stuck chunk (or a new one) self-heals via the cron within ~1–2 min of the grace period

## 5. Docs

- [x] 5.1 README: note images now have a cron safety net (poll fal by request id); architecture diagram
- [x] 5.2 AGENTS.md: image reconciler + imageTaskId + fal requests base
