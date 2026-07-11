## 1. Duration helper (src/lib/generation.ts)

- [x] 1.1 Add a pure `videoDurationFor(spokenLine: string): number` — `clamp(round(words / 2.5), 6, 30)`, counting whitespace-delimited words
- [x] 1.2 Update `startVideoGeneration` to accept the spoken line (e.g. `params.spokenPrompt`) and set `duration` via `videoDurationFor(...)` instead of the hardcoded `6`
- [x] 1.3 Keep sending the VIDEO/motion prompt as the API `prompt` (unchanged); mock mode unchanged

## 2. Worker wiring (src/index.ts)

- [x] 2.1 In `handleVideoJob`, extend the chunk SELECT to include `prompt` (the spoken line)
- [x] 2.2 Pass the spoken line into `startVideoGeneration`

## 3. Verify

- [x] 3.1 Unit-sanity the mapping: 10→6, 15→6, 20→8, 25→10, 30→12, 60→24, 74+→30
- [x] 3.2 Mock mode: submit a chunk, confirm the pipeline still completes
- [x] 3.3 `tsc --noEmit` clean
- [x] 3.4 (Optional, real mode) submit a long-PROMPT chunk and confirm the RunningHub request carries the computed duration (log/inspect)

## 4. Docs

- [x] 4.1 README design notes: video params now list computed duration (÷2.5 speaking-rate, clamp 6–30) instead of fixed 6s
- [x] 4.2 AGENTS.md: note duration is derived from the spoken PROMPT, not the VIDEO prompt
