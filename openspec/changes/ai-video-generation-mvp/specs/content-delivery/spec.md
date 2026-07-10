## ADDED Requirements

### Requirement: Store generated videos in Cloudflare R2
The system SHALL upload completed video files to Cloudflare R2 object storage for persistent storage and CDN delivery.

#### Scenario: Upload video to R2
- **WHEN** video generation webhook is received with video URL
- **THEN** system downloads video (or stores reference) and uploads to R2 with chunk-based naming

#### Scenario: Video naming in R2
- **WHEN** video is uploaded to R2
- **THEN** object key follows pattern: `videos/{sessionId}/{chunkId}.mp4`

#### Scenario: R2 credentials
- **WHEN** application initializes R2 client
- **THEN** system uses provided Account API token, Access Key ID, and Secret Access Key for authentication

#### Scenario: Video URL persistence
- **WHEN** video is uploaded to R2
- **THEN** system stores R2 URL in SQLite (may use fal.ai CDN URL directly if fal.ai returns permanent URL)

### Requirement: Manage image storage strategy
The system SHALL determine whether to store images on fal.ai CDN, download to R2, or use fal.ai URLs directly.

#### Scenario: Image URL handling - Option A (fal.ai CDN)
- **WHEN** fal.ai returns permanent image URL via webhook
- **THEN** system MAY store fal.ai URL directly in SQLite without re-uploading

#### Scenario: Image URL handling - Option B (R2 backup)
- **WHEN** fal.ai image is generated
- **THEN** system MAY download image and upload to R2 with naming pattern: `images/{sessionId}/{chunkId}.jpg`

#### Scenario: Image accessibility
- **WHEN** UI requests image URL from status API
- **THEN** system returns a URL that is valid and accessible (fal.ai CDN or R2 URL)

### Requirement: Use S3-compatible SDK for Cloudflare R2
The system SHALL use AWS SDK S3 client configured with Cloudflare R2 endpoint for storage operations.

#### Scenario: S3 client initialization
- **WHEN** application starts
- **THEN** system creates S3 client with: endpoint, region, credentials (Access Key ID, Secret Access Key)

#### Scenario: R2 endpoint configuration
- **WHEN** S3 client connects to R2
- **THEN** endpoint is configured as: `https://77d897891e616786d9d84e8dee7e429b.r2.cloudflarestorage.com`

#### Scenario: Bucket operations
- **WHEN** system uploads object to R2
- **THEN** request includes bucket name, object key, and file data

### Requirement: Provide downloadable URLs for generated content
The system SHALL ensure generated images and videos are accessible via URLs returned to the UI.

#### Scenario: Image URL in status response
- **WHEN** UI queries status for a chunk
- **THEN** response includes imageUrl that is directly accessible (can be embedded in `<img>` tag or downloaded)

#### Scenario: Video URL in status response
- **WHEN** UI queries status for a chunk
- **THEN** response includes videoUrl that is directly accessible (can be embedded in `<video>` tag or downloaded)

#### Scenario: URL expiration policy
- **WHEN** content is stored
- **THEN** URLs SHALL remain valid for at least 30 days (for MVP, may be indefinite)

### Requirement: Handle storage failures gracefully
The system SHALL detect and report storage operation failures.

#### Scenario: R2 upload failure
- **WHEN** upload to R2 fails (network error, auth error, quota exceeded)
- **THEN** system logs error and marks task as failed with storage error detail

#### Scenario: Fallback strategy
- **WHEN** R2 upload fails
- **THEN** system MAY attempt retry or store only the original fal.ai/magnific.com URL if available
