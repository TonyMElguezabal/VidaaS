## ADDED Requirements

### Requirement: Orchestrate multi-step generation pipeline
The system SHALL coordinate a sequence of image generation → video generation for each chunk using webhook callbacks to trigger next steps.

#### Scenario: Sequential chunk processing
- **WHEN** user submits multiple chunks
- **THEN** system processes each chunk through: (1) image generation, (2) wait for image webhook, (3) video generation, (4) wait for video webhook

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

### Requirement: Webhook receiver for magnific.com completions
The system SHALL expose an API endpoint that receives webhook callbacks from magnific.com when video generation completes.

#### Scenario: Webhook receiver endpoint exists
- **WHEN** magnific.com calls the webhook URL with video generation result
- **THEN** system receives POST at `/api/webhooks/magnific` endpoint

#### Scenario: Webhook parsing and correlation
- **WHEN** webhook payload is received from magnific.com
- **THEN** system extracts video URL and chunk correlation ID, updates chunk state

#### Scenario: Mark chunk complete
- **WHEN** video webhook is processed successfully
- **THEN** system marks chunk as complete and both image/video URLs are stored

### Requirement: Handle webhook delivery failures
The system SHALL be resilient to webhook delivery issues (retries, delayed processing).

#### Scenario: Webhook retry handling
- **WHEN** webhook is received multiple times for same generation task
- **THEN** system processes idempotently (does not duplicate results)

#### Scenario: Out-of-order webhook processing
- **WHEN** webhooks are received out of expected order (e.g., video webhook before image webhook)
- **THEN** system handles gracefully with appropriate error handling or queuing

### Requirement: Pass correlation data in webhook URLs
The system SHALL include chunk ID in webhook URL to enable correlation of responses to originating requests.

#### Scenario: Chunk ID in webhook URL
- **WHEN** system initiates image generation with fal.ai
- **THEN** webhook URL includes chunk ID as query parameter: `/api/webhooks/fal?chunkId=<id>`

#### Scenario: Webhook URL construction
- **WHEN** system constructs webhook URLs for external API calls
- **THEN** URLs are fully qualified (include domain/protocol) and routable from external services
