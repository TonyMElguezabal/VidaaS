## 1. POC: Verify API Integration (Complete ✓)

- [x] 1.1 Test fal.ai image generation API: Confirmed working, returns images immediately via @fal-ai/client
- [x] 1.2 Test fal.ai webhook: Confirmed sync mode (no async webhooks needed for images)
- [x] 1.3 Test magnific.com video generation API: Confirmed working, accepts requests and returns task_id
- [x] 1.4 Test magnific.com webhook: Confirmed accepts webhook_url parameter
- [x] 1.5 Verify webhook correlation: Confirmed query parameters can be passed in webhook URLs
- [x] 1.6 Document exact API payload formats and webhook response structures for implementation

## 2. Project Setup: Cloudflare Workers + Wrangler

- [x] 2.1 Initialize project with `wrangler init --type javascript` and set up TypeScript
- [x] 2.2 Create folder structure: `src/workers/`, `src/handlers/`, `src/lib/`, `src/types/`, `src/migrations/`, `frontend/`
- [x] 2.3 Install dependencies: `wrangler`, `d1`, `hono`, `@aws-sdk/client-s3`, `uuid`
- [x] 2.4 Create `wrangler.toml` with D1 database, Queues, Durable Objects bindings, R2 binding
- [x] 2.5 Create `.env.local` and `.env.example` for API keys (fal.ai, magnific.com, R2 credentials)
- [x] 2.6 Set up `.gitignore` for wrangler secrets, dist files, .wrangler/

## 3. Database Setup: Cloudflare D1

- [x] 3.1 Create D1 database schema: `src/migrations/0001_init.sql` with sessions, chunks, tasks, queue_jobs tables (+ `0002_add_error_column.sql`)
- [x] 3.2 Create D1 database (id eb176d5e-...) and run migrations via `wrangler d1 execute`
- [x] 3.3 Test D1 queries locally with `wrangler dev` (POST/GET verified)
- [x] 3.4 Verify schema and indexes created correctly

## 4. Mock Data & Testing Framework

- [x] 4.1 Create mock responses for fal.ai (image generation) based on POC response format
- [x] 4.2 Create mock responses for magnific.com (video generation) based on POC response format
- [x] 4.3 Create test utilities in `src/lib/mocks.ts`
- [x] 4.4 Environment flag to switch between mock and real APIs (ENVIRONMENT variable)

## 5. API Handler: Chunk Submission

- [x] 5.1 Create `src/index.ts`: Main Hono app with `POST /api/chunks` handler
- [x] 5.2 Implement chunk parsing via `src/lib/chunk-parser.ts`: split by "—" delimiter, extract ID, PROMPT, IMAGE, VIDEO
- [x] 5.3 Implement validation using Zod: check all fields present, no duplicate IDs, non-empty prompts
- [x] 5.4 Create session: generate UUID, store in D1
- [x] 5.5 Store chunks in D1
- [x] 5.6 Enqueue image generation jobs to Cloudflare Queue for each chunk
- [x] 5.7 Return sessionId + chunk list to client

## 6. API Handler: Status Query

- [x] 6.1 Implement `GET /api/status?sessionId=<id>` handler in `src/index.ts`
- [x] 6.2 Query D1 for session, chunks, tasks
- [x] 6.3 Build response with status, imageUrl, videoUrl, errors for each chunk
- [x] 6.4 Include session expiration (2 days from creation)

## 7. Background Queue: Image Generation

- [x] 7.1 Queue consumers implemented in `src/index.ts` (image + video), staggered enqueue
- [x] 7.2 Implement image generation call to fal.ai via `src/lib/generation.ts` (mock + real)
- [x] 7.3 Implement 30-second stagger: `delaySeconds: i * 30` on enqueue (verified: b,c stay submitted)
- [x] 7.4 Update D1 chunk status: submitted → image-generating → image-complete
- [x] 7.5 Store image URL in D1
- [x] 7.6 Trigger video generation: image consumer hands off to VIDEO_QUEUE → magnific.com with webhook URL
- [x] 7.7 Implement retry mechanism: `message.retry()` up to MAX_RETRIES=3 (same chunkId preserved)
- [x] 7.8 On final failure, mark chunk as failed with error message (error column)

## 8. Webhook Handler: Video Completion

- [x] 8.1 `POST /api/webhooks/magnific` handler in `src/index.ts`
- [x] 8.2 Extract chunkId AND sessionId from query parameters (unambiguous correlation)
- [x] 8.3 Parse magnific.com webhook payload: extract video URL from data.generated[0].url
- [x] 8.4 Verify idempotency: if chunk already complete with videoUrl, return early (verified)
- [x] 8.5 Update D1: chunk status → complete, store video URL
- [x] 8.6 Store magnific.com URL directly (R2 download deferred per Option B decision)

## 9. Frontend: Next.js Pages + React Components

- [ ] 9.1 Set up `frontend/` folder with Next.js (or similar static site generator)
- [ ] 9.2 Create `pages/index.tsx`: main page layout
- [ ] 9.3 Create `components/ChunkForm.tsx`: textarea input, submit button, validation feedback
- [ ] 9.4 Create `components/StatusDashboard.tsx`: displays chunks with statuses
- [ ] 9.5 Create `components/ChunkProgress.tsx`: shows per-chunk progress bar + status
- [ ] 9.6 Create `components/MediaPreview.tsx`: displays image/video previews when available
- [ ] 9.7 Implement polling hook: `useStatus(sessionId)` polls `/api/status` every 2 seconds

## 10. Frontend: LocalStorage Persistence

- [ ] 10.1 Implement `useLocalStorage(sessionId)`: save sessionId + URLs to localStorage
- [ ] 10.2 Add 2-day expiration check on page load
- [ ] 10.3 Show "Resume session?" if session in localStorage and not expired
- [ ] 10.4 Clear expired sessions on load

## 11. Frontend: Error Display & Retry

- [ ] 11.1 Add error UI: show error messages from API for failed chunks
- [ ] 11.2 Add manual retry button for failed chunks
- [x] 11.3 Backend retry endpoint `POST /api/retry` (re-enqueues chunk by sessionId+chunkId; verified)

## 12. Webhook Testing: ngrok Setup (Local Development)

- [ ] 12.1 Document how to install and run ngrok locally
- [ ] 12.2 Create script: `npm run ngrok` exposes localhost:8787 (Cloudflare dev port)
- [ ] 12.3 Use ngrok URL as `WEBHOOK_URL` environment variable during local testing
- [ ] 12.4 Test flow: submit chunk → image generates → ngrok receives webhook callback

## 13. Integration: Real APIs (Staged)

- [ ] 13.1 Switch mock flag: enable real fal.ai API calls
- [ ] 13.2 Test: submit chunk, verify image generates via real API
- [ ] 13.3 Fix any response format mismatches vs mocks
- [ ] 13.4 Switch mock flag: enable real magnific.com API calls
- [ ] 13.5 Test: with real image, trigger video generation
- [ ] 13.6 Verify webhook received and video URL stored

## 14. UI Polish & UX

- [ ] 14.1 Add progress bars: visual indicator of image/video generation progress
- [ ] 14.2 Add loading spinners: show during API calls
- [ ] 14.3 Add better styling: use Tailwind for professional look
- [ ] 14.4 Add countdown timer: show remaining time before 20-min timeout
- [ ] 14.5 Add estimated duration: "Image: ~2-5 min, Video: ~1-3 min"

## 15. Error Handling & Resilience

- [x] 15.1 Add input validation: reject malformed chunks with clear error messages (verified: missing field, duplicate ID)
- [ ] 15.2 Add timeout warning: at 15 min, show "Still processing..." message
- [ ] 15.3 Add 20-min timeout: show "Timeout - videos may not complete. Retry?" button
- [ ] 15.4 Add retry button: allow user to resubmit failed chunks
- [x] 15.5 Add logging: console log all API calls, webhook receipts, errors for debugging (backend)

## 16. End-to-End Testing

- [x] 16.1 Test single chunk: submit → image → video → both URLs stored (verified, mock mode)
- [x] 16.2 Test multi-chunk: verify parallel image generation with 30s stagger (verified: a complete, b/c queued)
- [ ] 16.3 Test error recovery: mock API failure, verify retry mechanism works
- [ ] 16.4 Test timeout: trigger manual timeout at 20 min, verify user can retry
- [x] 16.5 Test webhook idempotency: call webhook twice, verify no duplicates (verified)
- [ ] 16.6 Test session recovery: close browser mid-generation, resume from localStorage

## 17. Deployment Preparation

- [ ] 17.1 Create `.env.production` template with Cloudflare secrets management
- [ ] 17.2 Document environment setup: which vars go in Cloudflare dashboard vs local
- [ ] 17.3 Test deployment: `wrangler publish` to Cloudflare
- [ ] 17.4 Configure D1 in production: run migrations
- [ ] 17.5 Configure R2 bucket: create if not exists
- [ ] 17.6 Test end-to-end on Cloudflare staging

## 18. Documentation

- [ ] 18.1 Create README.md: project overview, architecture, setup instructions
- [ ] 18.2 Document API endpoints: request/response formats
- [ ] 18.3 Document environment variables: all required keys and how to obtain them
- [ ] 18.4 Create example chunk format: show user how to structure input
- [ ] 18.5 Add troubleshooting guide: common issues and solutions
- [ ] 18.6 Document webhook testing: how to use ngrok locally
