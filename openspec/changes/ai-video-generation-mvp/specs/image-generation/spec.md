## ADDED Requirements

### Requirement: Generate images via fal.ai API
The system SHALL call fal.ai's Seedream v5 Pro text-to-image API to generate images from text prompts in 16:9 landscape format (e.g., 1920x1080).

#### Scenario: Successful image generation request
- **WHEN** system initiates image generation with a chunk's IMAGE prompt
- **THEN** system receives async acknowledgment from fal.ai including a request ID or webhook URL

#### Scenario: Image format specification
- **WHEN** image generation is requested
- **THEN** generated image SHALL be in 16:9 landscape aspect ratio with minimum 1024 pixels in largest dimension

#### Scenario: Image delivery
- **WHEN** image generation completes
- **THEN** system receives image URL via webhook callback (preferably fal.ai CDN URL or downloadable asset)

### Requirement: Use webhook for async completion
The system SHALL provide a webhook URL to fal.ai that receives notifications when image generation completes, including correlation to the originating chunk.

#### Scenario: Webhook payload received
- **WHEN** fal.ai completes image generation
- **THEN** system receives webhook POST containing image URL and chunk correlation ID

#### Scenario: Chunk correlation in webhook
- **WHEN** webhook is invoked for image generation completion
- **THEN** webhook payload SHALL include chunk ID to allow system to match result to originating request

### Requirement: Handle image generation failures
The system SHALL detect and report failures in image generation.

#### Scenario: API error response
- **WHEN** fal.ai rejects the generation request (invalid prompt, API error, etc.)
- **THEN** system receives error indication and marks chunk task as failed with error details

#### Scenario: Timeout handling
- **WHEN** image generation does not complete within reasonable time (e.g., 5 minutes)
- **THEN** system logs warning and may retry or mark as failed based on configuration

### Requirement: Persist generated image URL
The system SHALL store the generated image URL for later reference during video generation.

#### Scenario: Image URL storage
- **WHEN** image generation webhook is received successfully
- **THEN** system stores image URL in SQLite associated with chunk ID
