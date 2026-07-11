## Why

Video clips are currently a fixed 6 seconds regardless of the scene. Since each chunk's spoken line (PROMPT) will be narrated over its clip, the clip should last about as long as the line takes to speak — otherwise short lines get padded and long lines get cut off. Deriving duration from the spoken line's length makes each clip fit its narration.

## What Changes

- Compute the RunningHub `duration` per chunk from the **PROMPT** (the spoken line) instead of hardcoding `6`.
- Use a **speaking-rate model**: `duration = clamp(round(words / 2.5), 6, 30)` — ~2.5 words/second (≈150 wpm), clamped to RunningHub's valid range `6–30` seconds.
- The value sent to the API as `prompt` is unchanged — still the chunk's **VIDEO** (motion) prompt. Only `duration` is derived, and it is derived from a different field (the spoken PROMPT).

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `video-generation`: `duration` is computed from the spoken-line word count (speaking-rate model) rather than fixed at 6s.

## Impact

- **Code**: `src/lib/generation.ts` — add a pure `videoDurationFor(spokenLine)` helper and use it for `duration`; `startVideoGeneration` must receive the spoken line (or a precomputed duration) in addition to the video prompt. `src/index.ts` — `handleVideoJob` already reads the chunk; it must also select `prompt` (spoken line) and pass it through.
- **No DB migration**; no new secrets/config.
- **Cost**: clips now scale with narration length (RunningHub bills by length). The ÷2.5 model keeps typical lines short/cheap and only lengthens genuinely long lines (the 30s cap needs ~73 words).
- **Mock mode** unaffected.
