## ADDED Requirements

### Requirement: Reconcile stuck image generation via polling
The system SHALL treat the fal.ai image webhook as a best-effort fast path and provide a cron-based reconciler that recovers chunks whose image webhook never arrived, so a dropped webhook self-heals.

#### Scenario: Reconciler runs on cron
- **WHEN** the cron trigger fires (every minute)
- **THEN** the system SHALL query for chunks in `image-generating` state that have a stored fal `imageTaskId` and have been in that state longer than a short grace period

#### Scenario: Recover a completed image
- **WHEN** the reconciler polls fal for such a chunk and fal reports the image is ready
- **THEN** the system SHALL store the image URL, set the chunk to `image-complete`, and enqueue the video job — the same completion path as the webhook

#### Scenario: Grace period defers to the webhook
- **WHEN** a chunk entered `image-generating` less than the grace period ago
- **THEN** the reconciler SHALL NOT poll it, giving the webhook first opportunity to complete it

#### Scenario: No double video enqueue on race
- **WHEN** the webhook and the reconciler both attempt to complete the same chunk
- **THEN** completion SHALL be idempotent and the video job SHALL be enqueued at most once
