## ADDED Requirements

### Requirement: Download all videos when the batch is complete
When every chunk in a session has reached `complete`, the UI SHALL offer a control that downloads all videos as separate files (not zipped), one per chunk, in chunk order.

#### Scenario: Download-all control appears only when all complete
- **WHEN** every chunk in the session is `complete` with a video URL
- **THEN** the UI SHALL show a "Download all videos" control (and hide it while any chunk is still in progress or failed)

#### Scenario: Sequential separate downloads in order
- **WHEN** the user activates "Download all videos"
- **THEN** the UI SHALL trigger one download per chunk, in chunk order, as individual files (not a zip)

#### Scenario: Same-origin attachment download
- **WHEN** a video is downloaded
- **THEN** it SHALL be served via a same-origin endpoint (`GET /api/download?sessionId=&chunkId=`) that looks the video up by id and streams it with `Content-Disposition: attachment`, so the cross-origin RunningHub URL downloads (rather than navigates) with a chunk-named file

#### Scenario: Download endpoint is not an open proxy
- **WHEN** the download endpoint is called
- **THEN** it SHALL only stream a video resolved from the session's own chunk record, never an arbitrary caller-supplied URL
