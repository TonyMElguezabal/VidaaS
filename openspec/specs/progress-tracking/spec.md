# progress-tracking Specification

## Purpose
TBD - created by archiving change ai-video-generation-mvp. Update Purpose after archive.
## Requirements
### Requirement: Persist chunk state to SQLite
The system SHALL store chunk and task state in a local SQLite database to enable state recovery and status queries across requests.

#### Scenario: Initialize database on startup
- **WHEN** application starts
- **THEN** system creates SQLite database with chunks and tasks tables if they don't exist

#### Scenario: Store chunk metadata
- **WHEN** chunk is parsed and validated
- **THEN** system stores chunk: id, prompt, imagePrompt, videoPrompt, createdAt

#### Scenario: Track task lifecycle
- **WHEN** task (image or video generation) is created
- **THEN** system stores task: chunkId, taskType (image|video), status (pending|processing|completed|failed), resultUrl, createdAt, updatedAt

#### Scenario: Update task on completion
- **WHEN** webhook is received for generation completion
- **THEN** system updates corresponding task: status=completed, resultUrl=<url>, updatedAt=<timestamp>

### Requirement: Expose status API for UI polling
The system SHALL provide API endpoints that return current state of all chunks and tasks for the active generation batch.

#### Scenario: Get all chunks and their status
- **WHEN** UI calls `/api/status`
- **THEN** system returns array of chunks with their task statuses (image and video generation status for each)

#### Scenario: Status response format
- **WHEN** status API is called
- **THEN** response includes: chunkId, status (submitted|image-generating|image-complete|video-generating|complete|failed), imageUrl, videoUrl, errors

#### Scenario: Status polling
- **WHEN** UI polls `/api/status` every 2 seconds
- **THEN** system returns latest state from SQLite database

### Requirement: Track generation session
The system SHALL associate chunks and tasks with a generation session to organize multiple batch submissions.

#### Scenario: Create session on batch submission
- **WHEN** user submits chunk batch
- **THEN** system creates session with sessionId and stores all chunks associated with session

#### Scenario: Query by session
- **WHEN** UI requests status
- **THEN** UI passes sessionId and receives only chunks/tasks for that session

#### Scenario: Session isolation
- **WHEN** multiple users/batches are in progress
- **THEN** results are isolated by sessionId (user A doesn't see user B's chunks)

### Requirement: Handle state recovery
The system SHALL persist state such that jobs can be queried even after server restart.

#### Scenario: State survives restart
- **WHEN** server restarts with incomplete generation tasks
- **THEN** state is recovered from SQLite and UI can resume polling for in-flight jobs

#### Scenario: Completed state is permanent
- **WHEN** chunk generation is complete and URLs are stored
- **THEN** state persists indefinitely in SQLite (until cleanup/deletion)

### Requirement: Error tracking
The system SHALL store error details when tasks fail.

#### Scenario: Capture error details
- **WHEN** API call fails (fal.ai or RunningHub error)
- **THEN** system stores errorMessage, errorCode, errorTimestamp in task record

#### Scenario: Report errors to UI
- **WHEN** UI queries status for failed chunk
- **THEN** response includes error details for display to user

