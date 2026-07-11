## Context

Video `duration` is hardcoded to `6` in `startVideoGeneration`. Each chunk has a spoken PROMPT (the narrated line) and a separate VIDEO prompt (motion instructions, sent to RunningHub as `prompt`). The clip should last about as long as the PROMPT takes to speak, so narration (added later) fits over it.

## Goals / Non-Goals

**Goals:**
- Compute `duration` from the spoken PROMPT's length using a speaking-rate model.
- Keep the change small, pure, and unit-testable.

**Non-Goals:**
- Changing what is sent as the API `prompt` (still the VIDEO/motion prompt).
- Adding real narration/TTS (that's a separate, later effort).
- Per-chunk overrides or user-tunable rate in the UI.

## Decisions

### Decision 1: Speaking-rate model at 2.5 words/second
`duration = clamp(round(words / 2.5), 6, 30)`.

**Rationale:** 2.5 wps (~150 wpm) is a neutral narration pace, so the clip length tracks how long the line takes to say. Chosen over the earlier linear "15/30 → 6/29" rule because that rule padded medium lines (e.g., a 25-word line → 21s clip for ~10s of speech), wasting video and ~2× the cost.

**Alternatives considered:** linear word→duration ramp (padded/expensive); fixed 6s (current, ignores line length); LLM-estimated speech time (overkill).

### Decision 2: Clamp to the full valid range 6–30
RunningHub accepts `6–30` inclusive, so `30` is a valid maximum; no "max-1" margin is needed (that was an artifact of the earlier linear rule). With ÷2.5, the cap is only reached by ~74+ word lines, which are rare.

### Decision 3: Word counting
`words = prompt.trim().split(/\s+/).filter(Boolean).length`. Punctuation attached to words counts as one word — an acceptable rough proxy. Empty PROMPT → 0 words → clamps to 6 (PROMPT is already validated non-empty at input).

### Decision 4: Plumbing — pass the spoken line into video submission
`startVideoGeneration` currently receives only the VIDEO prompt. `handleVideoJob` (which reads the chunk) will additionally `SELECT prompt` and pass the spoken line through so `videoDurationFor()` can compute `duration`. A pure `videoDurationFor(spokenLine: string): number` helper lives in `generation.ts`.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| Cost scales with narration length (RunningHub bills by length) | ÷2.5 keeps typical lines short; only long lines lengthen. Cap 30 bounds worst case. |
| Word count ≠ true speech time (numbers, abbreviations, pacing) | Rough proxy is acceptable for MVP; rate constant can be tuned later. |
| Speaking rate is a fixed assumption | 2.5 wps is documented and centralized; easy to adjust. |

## Reference mapping (÷2.5, clamp 6–30)

| PROMPT words | 10 | 15 | 20 | 25 | 30 | 40 | 60 | 74+ |
|---|----|----|----|----|----|----|----|----|
| duration (s) | 6 | 6 | 8 | 10 | 12 | 16 | 24 | 30 |
