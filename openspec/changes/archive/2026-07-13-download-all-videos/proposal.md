## Why

Once a batch finishes, users want every generated video without clicking each preview's download individually. This adds a one-click "Download all videos" action that downloads each clip as a separate file, in chunk order (not zipped).

> Retroactive record: this change was implemented directly first; these artifacts document what shipped. The `content-delivery` main spec already reflects it, so archive with `--skip-specs`.

## What Changes

- New same-origin endpoint `GET /api/download?sessionId=&chunkId=` that resolves the video by id and streams it with `Content-Disposition: attachment; filename="<chunkId>.mp4"`. Needed because RunningHub URLs are cross-origin, where the `download` attribute is ignored. It resolves the URL from the chunk record only — never an arbitrary caller-supplied URL — so it is not an open proxy.
- New UI "Download all videos" button shown only when every chunk is `complete`; it triggers one download per chunk in order, staggered ~800ms so the browser registers separate downloads, and warns the browser may prompt to allow multiple downloads.

## Capabilities

### Modified Capabilities
- `content-delivery`: adds a "Download all videos when the batch is complete" requirement (download-all control, sequential separate downloads, same-origin attachment endpoint, not-an-open-proxy).

## Impact

- **Code**: `src/index.ts` (`/api/download`), `public/index.html` (button + `downloadAll`).
- No DB migration, no new secrets, no added external cost (streams the existing RunningHub video).
