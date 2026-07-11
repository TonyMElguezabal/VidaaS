## MODIFIED Requirements

### Requirement: Generate videos via RunningHub API
The system SHALL call RunningHub's `rhart-video-g/image-to-video` API to generate videos from the generated image and the chunk's VIDEO prompt. magnific.com SHALL NOT be used.

#### Scenario: Successful video generation request
- **WHEN** the system initiates video generation for an image-complete chunk
- **THEN** it POSTs to `https://www.runninghub.ai/openapi/v2/rhart-video-g/image-to-video` with `Authorization: Bearer <RUNNINGHUB_API_KEY>`
- **AND** receives a response containing a `taskId` and a `status` of `QUEUED` or `RUNNING`

#### Scenario: Video parameters
- **WHEN** a video request is built
- **THEN** the body SHALL include the chunk's VIDEO prompt as `prompt`, the fal.ai image URL in `imageUrls`, `aspectRatio: "16:9"`, `resolution: "720p"`, and a `duration` computed from the chunk's spoken PROMPT (see "Derive video duration from the spoken line")

#### Scenario: Image passed by URL
- **WHEN** the request is built
- **THEN** the fal.ai CDN image URL SHALL be passed directly in `imageUrls` with no upload step

#### Scenario: Concurrent submissions
- **WHEN** multiple chunks submit video jobs close together
- **THEN** RunningHub SHALL accept and queue them (status `QUEUED`) rather than rejecting for concurrency

## ADDED Requirements

### Requirement: Derive video duration from the spoken line
The system SHALL compute each video's `duration` (seconds) from the word count of the chunk's spoken PROMPT using a speaking-rate model, so a clip lasts about as long as its line takes to narrate. The VIDEO (motion) prompt SHALL NOT affect duration.

The model is: `duration = clamp(round(words / 2.5), 6, 30)`, where `words` is the whitespace-delimited word count of the PROMPT, `2.5` is the assumed speaking rate (words/second), and `6`–`30` is RunningHub's valid range.

#### Scenario: Short line uses the minimum
- **WHEN** the spoken PROMPT has 15 or fewer words
- **THEN** `duration` SHALL be `6` (the minimum)

#### Scenario: Medium line scales with narration length
- **WHEN** the spoken PROMPT has 25 words
- **THEN** `duration` SHALL be `10` (round(25 / 2.5))

#### Scenario: Long line is capped at the maximum
- **WHEN** the spoken PROMPT is long enough that `round(words / 2.5)` exceeds 30 (roughly 74+ words)
- **THEN** `duration` SHALL be capped at `30`

#### Scenario: Duration is derived from PROMPT, not the VIDEO prompt
- **WHEN** a chunk has a short spoken PROMPT but a long VIDEO (motion) prompt
- **THEN** `duration` SHALL reflect the spoken PROMPT's word count, not the VIDEO prompt's
