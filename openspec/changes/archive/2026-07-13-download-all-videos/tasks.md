## 1. Download endpoint (src/index.ts)

- [x] 1.1 `GET /api/download?sessionId=&chunkId=` resolves the chunk's videoUrl, fetches it, and streams with `Content-Type: video/mp4` + `Content-Disposition: attachment; filename="<sanitized chunkId>.mp4"`
- [x] 1.2 Guards: 400 missing params, 404 no video (not an open proxy), 502 upstream error

## 2. Frontend (public/index.html)

- [x] 2.1 `allComplete` flag: every chunk `complete` with a videoUrl
- [x] 2.2 "Download all videos" button shown only when `allComplete`; disabled while downloading
- [x] 2.3 `downloadAll()` triggers each same-origin download in chunk order, staggered ~800ms
- [x] 2.4 Note that the browser may prompt to allow multiple downloads

## 3. Verify

- [x] 3.1 Endpoint returns 200 `video/mp4` with attachment header + correct length (verified live: recA.mp4, 2.3MB)
- [x] 3.2 Unknown chunk → 404 JSON; missing params → 400 (verified live)
- [x] 3.3 Frontend `node --check` clean; Worker `tsc --noEmit` clean

## 4. Docs

- [x] 4.1 content-delivery spec: "Download all videos when the batch is complete"
- [x] 4.2 README: download-all note
