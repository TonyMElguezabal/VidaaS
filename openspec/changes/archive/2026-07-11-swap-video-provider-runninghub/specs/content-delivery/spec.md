## MODIFIED Requirements

### Requirement: Provide downloadable URLs for generated content
The system SHALL surface generated image and video URLs to the UI. Video URLs from RunningHub expire 24 hours after generation, and the UI SHALL communicate this.

#### Scenario: Video URL in status response
- **WHEN** the UI queries status for a completed chunk
- **THEN** the response includes a `videoUrl` that is directly playable/downloadable

#### Scenario: 24-hour expiry notice
- **WHEN** a session shows completed videos
- **THEN** the UI SHALL display that video links expire within 24 hours and should be downloaded

#### Scenario: No R2 archival in this change
- **WHEN** a video completes
- **THEN** the system stores RunningHub's raw result URL as-is and does NOT download or re-host it (R2 archival is out of scope here)
