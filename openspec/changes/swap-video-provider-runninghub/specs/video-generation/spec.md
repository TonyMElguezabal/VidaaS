## MODIFIED Requirements

### Requirement: Generate videos via RunningHub API
The system SHALL call RunningHub's `rhart-video-g/image-to-video` API to generate videos from the generated image and the chunk's VIDEO prompt. magnific.com SHALL NOT be used.

#### Scenario: Successful video generation request
- **WHEN** the system initiates video generation for an image-complete chunk
- **THEN** it POSTs to `https://www.runninghub.ai/openapi/v2/rhart-video-g/image-to-video` with `Authorization: Bearer <RUNNINGHUB_API_KEY>`
- **AND** receives a response containing a `taskId` and a `status` of `QUEUED` or `RUNNING`

#### Scenario: Video parameters
- **WHEN** a video request is built
- **THEN** the body SHALL include the chunk's VIDEO prompt as `prompt`, the fal.ai image URL in `imageUrls`, `aspectRatio: "16:9"`, `resolution: "720p"`, and `duration: 6`

#### Scenario: Image passed by URL
- **WHEN** the request is built
- **THEN** the fal.ai CDN image URL SHALL be passed directly in `imageUrls` with no upload step

#### Scenario: Concurrent submissions
- **WHEN** multiple chunks submit video jobs close together
- **THEN** RunningHub SHALL accept and queue them (status `QUEUED`) rather than rejecting for concurrency

### Requirement: Complete video generation by polling
The system SHALL determine video completion by polling RunningHub; there is no webhook.

#### Scenario: Poll for result
- **WHEN** a chunk has a stored `videoTaskId` and status `video-generating`
- **THEN** the cron reconciler POSTs to `https://www.runninghub.ai/openapi/v2/query` with `{ taskId }` and `Bearer` auth

#### Scenario: Successful completion
- **WHEN** the query response `status` is `SUCCESS`
- **THEN** the system extracts the result whose `outputType` is `mp4` (falling back to the first result) and stores its `url` as the chunk's video URL, setting status `complete`

#### Scenario: Failure
- **WHEN** the query response `status` is `FAILED`
- **THEN** the chunk is marked `failed` with the error detail

#### Scenario: Still processing
- **WHEN** the query response `status` is `QUEUED` or `RUNNING`
- **THEN** the chunk remains `video-generating` and is polled again on the next cron tick

### Requirement: Persist the RunningHub task id
The system SHALL store the RunningHub `taskId` to enable polling.

#### Scenario: Store task id on submit
- **WHEN** a video job is submitted and a `taskId` is returned
- **THEN** the system stores it in the chunk's `videoTaskId` column

## REMOVED Requirements

### Requirement: Use webhook for async completion
**Reason**: RunningHub is poll-only; the cron reconciler is the sole completion path.
**Migration**: The `/api/webhooks/magnific` endpoint and all magnific webhook parsing are removed. Completion is handled by polling `POST /openapi/v2/query`.
