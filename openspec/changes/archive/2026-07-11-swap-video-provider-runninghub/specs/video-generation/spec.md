## ADDED Requirements

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
- **THEN** the system SHALL extract the result whose `outputType` is `mp4` (falling back to the first result) and store its `url` as the chunk's video URL, setting status `complete`

#### Scenario: Failure
- **WHEN** the query response `status` is `FAILED`
- **THEN** the chunk SHALL be marked `failed` with the error detail

#### Scenario: Still processing
- **WHEN** the query response `status` is `QUEUED` or `RUNNING`
- **THEN** the chunk SHALL remain `video-generating` and be polled again on the next cron tick

### Requirement: Persist the RunningHub task id
The system SHALL store the RunningHub `taskId` to enable polling.

#### Scenario: Store task id on submit
- **WHEN** a video job is submitted and a `taskId` is returned
- **THEN** the system SHALL store it in the chunk's `videoTaskId` column

## MODIFIED Requirements

### Requirement: Handle video generation failures
The system SHALL detect and report failures in video generation.

#### Scenario: API error response
- **WHEN** RunningHub rejects the submission or returns an `errorCode` (invalid image, invalid prompt, API error, etc.)
- **THEN** the system SHALL mark the chunk as failed with error details

#### Scenario: Poll returns FAILED
- **WHEN** a `POST /openapi/v2/query` response reports `status: FAILED`
- **THEN** the chunk SHALL be marked `failed`

### Requirement: Persist generated video URL
The system SHALL store the generated video URL for later retrieval.

#### Scenario: Video URL storage
- **WHEN** the cron reconciler observes a `SUCCESS` result for a chunk
- **THEN** the system SHALL store the mp4 URL in D1 associated with the chunk

## REMOVED Requirements

### Requirement: Generate videos via magnific.com API
**Reason**: Provider fully replaced by RunningHub (`rhart-video-g/image-to-video`).
**Migration**: Video jobs now POST to `https://www.runninghub.ai/openapi/v2/rhart-video-g/image-to-video` with Bearer auth; see the new "Generate videos via RunningHub API" requirement.

### Requirement: Use webhook for async completion
**Reason**: RunningHub is poll-only; there is no video webhook.
**Migration**: The `/api/webhooks/magnific` endpoint is removed. Completion is detected by the cron reconciler polling `POST /openapi/v2/query`; see "Complete video generation by polling".
