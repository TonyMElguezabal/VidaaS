# async-orchestration Specification

## Purpose
TBD - created by archiving change ai-video-generation-mvp. Update Purpose after archive.
## Requirements
### Requirement: Orchestrate multi-step generation pipeline
The system SHALL coordinate a sequence of image generation → video generation for each chunk, using an image completion webhook and video result polling to trigger next steps.

#### Scenario: Sequential chunk processing
- **WHEN** user submits multiple chunks
- **THEN** system processes each chunk through: (1) image generation, (2) wait for image webhook, (3) video generation, (4) poll for video result

#### Scenario: Parallel chunk processing
- **WHEN** user submits multiple chunks
- **THEN** system MAY initiate image generation for multiple chunks in parallel (not blocked on one completing)

#### Scenario: Pipeline state transitions
- **WHEN** chunk is created
- **THEN** state transitions: submitted → image-generating → image-complete → video-generating → video-complete

### Requirement: Webhook receiver for fal.ai completions
The system SHALL expose an API endpoint that receives webhook callbacks from fal.ai when image generation completes.

#### Scenario: Webhook receiver endpoint exists
- **WHEN** fal.ai calls the webhook URL with image generation result
- **THEN** system receives POST at `/api/webhooks/fal` endpoint

#### Scenario: Webhook parsing and correlation
- **WHEN** webhook payload is received from fal.ai
- **THEN** system extracts image URL and chunk correlation ID, updates chunk state

#### Scenario: Trigger next step
- **WHEN** image webhook is processed successfully
- **THEN** system automatically initiates video generation for same chunk (if image URL is valid)

### Requirement: Poll RunningHub for video completions
RunningHub is poll-only (no webhook). The system SHALL detect video completion via a scheduled cron reconciler that polls RunningHub for chunks with a stored `videoTaskId`.

#### Scenario: Cron reconciler runs
- **WHEN** the cron trigger fires (every minute)
- **THEN** the system queries D1 for chunks in `video-generating` state with a `videoTaskId`

#### Scenario: Poll and correlate
- **WHEN** the reconciler has a chunk's `videoTaskId`
- **THEN** it POSTs to `https://www.runninghub.ai/openapi/v2/query` with `{ taskId }` and correlates the result back to that chunk

#### Scenario: Mark chunk complete
- **WHEN** the poll returns `status: SUCCESS`
- **THEN** the system extracts the mp4 result URL and marks the chunk `complete`, with both image and video URLs stored

### Requirement: Handle completion delivery failures
The system SHALL be resilient to duplicate or delayed completion signals (image webhook redeliveries, repeated video polls).

#### Scenario: Duplicate completion handling
- **WHEN** an image webhook is received more than once, or a video poll observes SUCCESS repeatedly for the same task
- **THEN** system processes idempotently (does not duplicate results)

#### Scenario: Delayed video completion
- **WHEN** a video result is not yet ready on a given cron tick
- **THEN** the chunk remains `video-generating` and is polled again on the next tick

### Requirement: Pass correlation data in webhook URLs
The system SHALL include chunk ID in webhook URL to enable correlation of responses to originating requests.

#### Scenario: Chunk ID in webhook URL
- **WHEN** system initiates image generation with fal.ai
- **THEN** webhook URL includes chunk ID as query parameter: `/api/webhooks/fal?chunkId=<id>`

#### Scenario: Webhook URL construction
- **WHEN** system constructs webhook URLs for external API calls
- **THEN** URLs are fully qualified (include domain/protocol) and routable from external services

