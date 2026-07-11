## ADDED Requirements

### Requirement: Persist the fal request id for reconciliation
The system SHALL persist the fal.ai `request_id` returned when an image job is submitted, so the cron reconciler can poll fal for the result if the webhook is missed.

#### Scenario: Store request id on submit
- **WHEN** an image generation job is submitted to fal's async queue and a `request_id` is returned
- **THEN** the system SHALL store it in the chunk's `imageTaskId` column

#### Scenario: Poll fal by request id
- **WHEN** the reconciler needs a stuck chunk's image result
- **THEN** it SHALL GET `https://queue.fal.run/bytedance/seedream/requests/{request_id}` with `Authorization: Key <FAL_API_KEY>` and, if the response contains an image URL, treat the image as complete
