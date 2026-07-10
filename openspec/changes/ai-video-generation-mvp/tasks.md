## 1. POC: Verify API Integration (Blocker)

- [ ] 1.1 Test fal.ai image generation API: POST request with text prompt, capture response structure and check if query parameters are preserved in webhook URL
- [ ] 1.2 Test fal.ai webhook: Manually trigger image generation and verify webhook payload structure (image URL location, parameter echoing)
- [ ] 1.3 Test magnific.com video generation API: POST request with image URL and prompt, capture response structure
- [ ] 1.4 Test magnific.com webhook: Manually trigger video generation and verify webhook payload structure (video URL, status field names)
- [ ] 1.5 Verify webhook correlation: Confirm both services echo back query parameters or metadata passed in webhook URL
- [ ] 1.6 Document exact API payload formats and webhook response structures for implementation

## 2. Project Setup

- [ ] 2.1 Initialize Next.js App Router project with TypeScript and Tailwind CSS
- [ ] 2.2 Create directory structure: `app/api`, `lib`, `components`, `db`, `public`
- [ ] 2.3 Install dependencies: `better-sqlite3` (SQLite), `@aws-sdk/client-s3` (Cloudflare R2), `uuid`
- [ ] 2.4 Create SQLite schema initialization script and integrate into app startup

## 3. API Routes: Core Infrastructure

- [ ] 3.1 Implement `POST /api/chunks`: Parse chunk input text, validate structure, create session, store in SQLite, return sessionId + parsed chunks
- [ ] 3.2 Implement `GET /api/status?sessionId=<id>`: Query SQLite for chunks and tasks, return current state with image/video URLs and error details
- [ ] 3.3 Implement `POST /api/webhooks/fal`: Receive image generation webhook, extract chunk ID from query params, update SQLite, trigger video generation
- [ ] 3.4 Implement `POST /api/webhooks/magnific`: Receive video generation webhook, extract chunk ID from query params, update SQLite, mark chunk complete

## 4. Async Orchestration: Generation Triggers

- [ ] 4.1 Create utility function to construct webhook URLs with chunk ID query parameters
- [ ] 4.2 Create fal.ai integration: POST to fal.ai API with IMAGE prompt, include webhook URL with chunkId parameter
- [ ] 4.3 Create magnific.com integration: POST to magnific.com API with image URL + VIDEO prompt + webhook URL with chunkId parameter
- [ ] 4.4 Implement state machine: chunk submission → image-generating → (webhook) → video-generating → (webhook) → complete
- [ ] 4.5 Add error handling: catch API errors, store error message in SQLite, mark task as failed

## 5. Content Storage

- [ ] 5.1 Configure Cloudflare R2 S3 client with provided credentials and endpoint
- [ ] 5.2 Implement image storage: In fal.ai webhook handler, store image URL from fal.ai CDN directly in SQLite (no re-upload for MVP)
- [ ] 5.3 Implement video storage: In magnific.com webhook handler, download video file and upload to Cloudflare R2 with key pattern `videos/{sessionId}/{chunkId}.mp4`
- [ ] 5.4 Add error handling: If R2 upload fails, log error and store magnific.com URL as fallback with note about temporary storage

## 6. Frontend: User Interface

- [ ] 6.1 Create input form component: textarea for chunk input, submit button, basic validation feedback
- [ ] 6.2 Create status dashboard component: displays all chunks with real-time status (submitted/image-generating/image-complete/video-generating/complete/failed)
- [ ] 6.3 Implement polling: React component polls `/api/status?sessionId=<id>` every 2 seconds and updates UI state
- [ ] 6.4 Add asset preview: Display image and video thumbnails/embeds when URLs are available
- [ ] 6.5 Add error display: Show error messages from failed chunks to user
- [ ] 6.6 Create layout: Simple page with form at top, status dashboard below (form → results flow)

## 7. Testing & Verification

- [ ] 7.1 End-to-end test: Submit single chunk, verify image generates, verify video generates, verify both stored correctly
- [ ] 7.2 Multi-chunk test: Submit 3-5 chunks, verify parallel image generation and sequential video generation
- [ ] 7.3 Error handling test: Trigger failures in API mocks, verify error messages appear in UI
- [ ] 7.4 State persistence test: Restart server during in-flight generation, verify session state recovers from SQLite
- [ ] 7.5 Webhook correlation test: Verify chunks are matched to correct images/videos (spot check 5+ chunks)

## 8. Polish & Deployment

- [ ] 8.1 Add input validation: Reject chunks with missing fields, duplicate IDs, empty prompts
- [ ] 8.2 Add UI refinements: Loading states, progress spinners, better formatting
- [ ] 8.3 Add logging: Log all API calls and webhook receipts for debugging
- [ ] 8.4 Create README with setup instructions, API key configuration, example chunk format
- [ ] 8.5 Prepare deployment: Build steps, environment variables documented, ready for testing environment
