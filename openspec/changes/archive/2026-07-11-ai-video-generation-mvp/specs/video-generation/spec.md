## ADDED Requirements

### Requirement: Generate videos via magnific.com API
The system SHALL call magnific.com's kling-v2.5-pro API to generate videos from generated images using text prompts.

#### Scenario: Successful video generation request
- **WHEN** system initiates video generation with generated image URL and chunk's VIDEO prompt
- **THEN** system receives async acknowledgment from magnific.com including a request ID or webhook URL

#### Scenario: Video parameters
- **WHEN** video generation is initiated
- **THEN** request SHALL include image, prompt, negative_prompt, cfg_scale (0.5), and duration (5 seconds)

#### Scenario: Video delivery
- **WHEN** video generation completes
- **THEN** system receives video file URL via webhook callback or download endpoint

### Requirement: Use webhook for async completion
The system SHALL provide a webhook URL to magnific.com that receives notifications when video generation completes, including correlation to the originating chunk.

#### Scenario: Webhook payload received
- **WHEN** magnific.com completes video generation
- **THEN** system receives webhook POST containing video URL and chunk correlation ID

#### Scenario: Chunk correlation in webhook
- **WHEN** webhook is invoked for video generation completion
- **THEN** webhook payload SHALL include chunk ID to allow system to match result to originating request

### Requirement: Start video generation only after image is ready
The system SHALL not attempt video generation until the image generation webhook confirms completion and image URL is stored.

#### Scenario: Sequential generation
- **WHEN** image generation webhook is received and processed
- **THEN** system automatically initiates video generation for same chunk

#### Scenario: Image prerequisite
- **WHEN** video generation is requested for a chunk without stored image URL
- **THEN** system returns error: "Image not yet generated for this chunk"

### Requirement: Handle video generation failures
The system SHALL detect and report failures in video generation.

#### Scenario: API error response
- **WHEN** magnific.com rejects the generation request (invalid image, invalid prompt, API error, etc.)
- **THEN** system receives error indication and marks chunk task as failed with error details

#### Scenario: Timeout handling
- **WHEN** video generation does not complete within reasonable time (e.g., 15 minutes)
- **THEN** system logs warning and may retry or mark as failed based on configuration

### Requirement: Persist generated video URL
The system SHALL store the generated video URL for later retrieval.

#### Scenario: Video URL storage
- **WHEN** video generation webhook is received successfully
- **THEN** system stores video URL in SQLite associated with chunk ID
