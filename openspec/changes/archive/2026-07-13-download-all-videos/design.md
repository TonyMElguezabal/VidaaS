## Context

Retroactive record of a shipped feature. Per-chunk videos already had a "Copy URL"/"Open" affordance; users wanted all clips at once without zipping.

## Goals / Non-Goals

**Goals:**
- One click downloads every video as separate files, in chunk order.
- Reliable real downloads (not tab navigation), with sensible filenames.

**Non-Goals:**
- Zipping into a single archive (explicitly not wanted).
- R2 re-hosting or changing the 24h URL expiry.

## Decisions

### Decision 1: Same-origin streaming endpoint, not client-side blob fetch
RunningHub video URLs are cross-origin (Tencent COS), where the `download` attribute is ignored (browsers navigate instead of downloading). A client `fetch → blob` would depend on the COS server's CORS headers (uncertain). Instead, `GET /api/download?sessionId=&chunkId=` fetches server-side and re-streams with `Content-Disposition: attachment` — same-origin, so downloads are reliable and files are named `<chunkId>.mp4`.

**Alternatives considered:** `<a download>` on the raw cross-origin URL (navigates, no download); client blob fetch (CORS-dependent); zip (excluded by requirement).

### Decision 2: Resolve by id, never proxy arbitrary URLs
The endpoint takes `sessionId`+`chunkId` and looks up `videoUrl` in D1. It never accepts a caller-supplied URL, avoiding an open proxy / SSRF vector.

### Decision 3: Sequential, staggered triggers
`downloadAll()` iterates chunks in order and clicks a same-origin link per video with an ~800ms gap so the browser registers each as a distinct download. The browser's one-time "allow multiple downloads?" prompt is expected; the UI notes it. Button is disabled while running and only shown when all chunks are `complete`.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| Browser blocks/collapses rapid downloads | ~800ms stagger + one-time allow-multiple prompt (noted in UI). |
| Proxy bandwidth through the Worker | Short 720p clips (~2–3 MB); response body is streamed, not buffered. |
| Video URL expired (24h) | Endpoint returns 502 upstream error; user can re-generate. |
