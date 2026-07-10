## Context

This MVP addresses rapid AI-driven video generation from user-provided scripts. Current state: no video generation capability exists. The system must orchestrate async multi-step generation (image → video) using third-party APIs with webhook callbacks for state transitions. **Deployment target: Cloudflare serverless (Workers, D1, Queues, Durable Objects).** Primary constraint: simplicity and speed-to-market over feature completeness, operating within serverless constraints (30s request timeout).

## Goals / Non-Goals

**Goals:**
- Enable end-to-end video generation from structured script chunks in a single session
- Implement async orchestration pattern using webhooks for non-blocking multi-step workflows
- Provide real-time progress visibility to users via polling
- Persist state to Cloudflare D1 for reliability across serverless restarts
- Implement background job queue (Cloudflare Queues) for long-running image generation (5-15 min)
- Demonstrate proof-of-concept for webhook correlation ID mechanism with fal.ai and magnific.com
- Deploy fully on Cloudflare (Workers, D1, Queues, Durable Objects)

**Non-Goals:**
- Persistent user accounts or authentication (MVP is public/sessionless)
- Batch job persistence across multiple sessions
- Advanced retry/recovery strategies (fail fast, report to user)
- Video hosting/streaming (rely on CDN URLs from services)
- Support for custom parameters (fixed 16:9 landscape, 5s duration, fixed cfg_scale)

## Decisions

### Decision 1: Architecture - Cloudflare Workers + D1 + Queues + Durable Objects

**Choice:** Deploy on Cloudflare:
- **Frontend**: Next.js hosted on Cloudflare Pages
- **API Routes**: Cloudflare Workers (30s timeout limit)
- **Database**: Cloudflare D1 (serverless SQLite)
- **Background Jobs**: Cloudflare Queues (for long-running image generation)
- **Stateful Operations**: Cloudflare Durable Objects (for webhook coordination)

**Rationale:** 
- Unified platform (no separate deployments)
- D1 provides persistent state without managing infrastructure
- Queues handle 5-15 min image generation without blocking Workers (30s timeout)
- Durable Objects coordinate state across async operations
- Built-in scaling, pay-per-use, zero-ops deployment

**Alternatives Considered:**
- Traditional Node.js server (Heroku/Railway): Simpler but requires infrastructure management
- Workers alone (no Queues): Can't handle 5-15 min image generation within 30s timeout
- Full microservices: Overkill for MVP, defeats serverless simplicity

### Decision 2: Async orchestration - Webhook-driven pipeline

**Choice:** Each step (image gen, video gen) is triggered by webhook callback from previous step, not client polling.

**Rationale:** External services (fal.ai, magnific.com) initiate callbacks when work completes. This is more reliable than client-side retry loops and keeps state in sync. Reduces client-side complexity.

**Alternatives Considered:**
- Client polls `/api/status`, client triggers next step via `/api/generate`: Extra API calls, potential race conditions, requires client-side state machine
- Server-side scheduled job processor: Adds complexity, overkill when webhooks are available
- Async queue (Bull): Same as above, overkill for MVP

### Decision 3: Webhook correlation - Chunk ID in webhook URL

**Choice:** Pass chunk ID as query parameter in webhook URL: `/api/webhooks/fal?chunkId=<id>`

**Rationale:** Requires POC confirmation that both fal.ai and magnific.com echo back the webhook URL. If they do, this is simplest correlation mechanism without custom headers or request body metadata.

**Alternatives Considered:**
- Store request ID in database, query webhook response: Requires fal.ai/magnific.com to return their request ID in webhook; adds lookup overhead
- Use custom headers: Services may not support custom headers in webhook calls
- Use request path (e.g., `/api/webhooks/fal/{chunkId}`): Requires URL path parsing, less flexible if chunk IDs contain special characters

**POC Required:** Verify both APIs support passing query parameters through webhook invocation.

### Decision 4: Image format - 16:9 landscape via fal.ai presets

**Choice:** Request images in 16:9 landscape (1920x1080 or similar preset) using fal.ai `image_size` parameter.

**Rationale:** User requirement for consistent aspect ratio. fal.ai supports preset dimensions; use simplest approach.

**Alternatives Considered:**
- Custom dimensions each time: Adds parameter tuning, potential quality variance
- Different aspect ratios per chunk: Out of scope, violates consistency goal

**POC Required:** Determine exact fal.ai parameter format for 16:9 (e.g., is there a preset constant or do we pass width/height object?).

### Decision 5: Content storage - Hybrid approach

**Choice:** For MVP:
- **Images:** Use fal.ai CDN URLs directly (store URL in SQLite, don't download/re-upload)
- **Videos:** Download from magnific.com and upload to Cloudflare R2 (since magnific.com URLs may be temporary)

**Rationale:** Minimizes bandwidth costs and operational complexity. fal.ai CDN is reliable for static images; videos need persistent storage per Cloudflare credentials provided.

**Alternatives Considered:**
- Store all images and videos in R2: More consistent, but unnecessary overhead and cost for images
- Rely entirely on service CDNs: Videos may expire, videos need guaranteed persistence
- Stream video generation directly to R2: Adds complexity, requires magnific.com to support S3-compatible PUT

**POC Required:** Confirm magnific.com webhook includes downloadable video URL (not just job ID).

### Decision 6: UI state updates - Polling from client

**Choice:** React client polls `/api/status?sessionId=<id>` every 2 seconds.

**Rationale:** Simple, requires no WebSocket infrastructure. For MVP with expected 5-15 minute generation times, polling is acceptable. Dashboard updates frequently enough for user feedback.

**Alternatives Considered:**
- Server-sent events (SSE): More efficient but adds server-side complexity
- WebSockets: Most efficient, but requires persistent connections and more infrastructure
- Webhook-driven UI updates: UI doesn't have endpoint to receive callbacks

### Decision 7: Session model - Stateless per submission

**Choice:** Each batch submission creates a new session UUID. UI holds sessionId, queries by sessionId. No user accounts.

**Rationale:** Simplest model for MVP. Session UUID is unique identifier for a batch. No authentication needed.

**Alternatives Considered:**
- Persistent sessions tied to browser: Requires cookie management, logout flow
- User accounts: Out of scope for MVP

### Decision 8: Error handling - Fail fast, report to user

**Choice:** If any API call fails (fal.ai/magnific.com), mark chunk as failed with error details in D1. UI displays error. No automatic retry.

**Rationale:** MVP scope. Retry logic can be added later. Gives user visibility into failures immediately.

**Alternatives Considered:**
- Exponential backoff retry: Adds queuing complexity, can mask real issues
- Partial failure recovery: Out of scope (e.g., retry only fal.ai, not magnific.com)

### Decision 9: Background image generation - Cloudflare Queues

**Choice:** Image generation (5-15 min blocking operation) runs in Cloudflare Queues worker, not in API endpoint.

**Flow:**
1. API Worker receives `/api/chunks` request
2. Validates chunks, saves to D1, creates session
3. Enqueues image generation jobs to Cloudflare Queue
4. Returns sessionId immediately (doesn't wait)
5. Queue Worker processes images asynchronously
6. Triggers video generation when image completes
7. Client polls `/api/status` to track progress

**Rationale:** Workers have 30s timeout; image generation takes 5-15 min. Queues provide reliable async job processing without blocking the API.

**Alternatives Considered:**
- Submit directly to fal.ai in API endpoint: Times out after 30s, user never gets completion
- Use Durable Objects for long-running tasks: Overkill, Queues designed exactly for this

### Decision 10: Webhook testing - ngrok for local development

**Choice:** During development, use ngrok to expose localhost for webhook testing:
```
ngrok http 8787
→ Provides public HTTPS URL like https://abc123.ngrok.io
→ Use https://abc123.ngrok.io/api/webhooks/magnific as webhook callback
```

**Rationale:** Cloudflare Workers are deployed immediately, but for early testing/debugging, local ngrok tunnel simplifies iteration.

**Alternatives Considered:**
- Deploy every change to Cloudflare: Slow iteration, can't debug locally
- Mock webhooks in tests: Doesn't verify real service integration

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| **Webhook correlation mechanism fails** (magnific.com doesn't echo chunkId in callback) | POC confirms query params are accepted. If callback doesn't include chunkId, store task_id in D1 and query on receipt. |
| **Webhook never arrives** (network failure, service outage) | User sees "processing" indefinitely. Add UI timeout (20 min) to alert user. Manual retry button in UI. |
| **Queue job times out or fails** (fal.ai down, network error) | Queue retries automatically (Cloudflare Queues has built-in retry). After max retries, mark chunk as failed in D1. |
| **Cloudflare D1 data loss or quota exceeded** | For MVP, D1 quota is generous (1GB+ per account). Data persists. Mitigation: Monitor usage, implement cleanup. |
| **Video generation takes longer than 20 min** | UI shows timeout warning. Manual retry button triggers resubmission. Polling continues if user stays on page. |
| **Cloudflare R2 upload fails** | Store magnific.com temporary URL in D1. Add note about 24-48 hour expiration. User can re-generate if needed. |
| **Multiple chunks process simultaneously** | Cloudflare Queues can handle concurrent jobs. No rate-limiting risk; magnific.com API is called sequentially per chunk. |
| **ngrok tunnel expires during development** | Get new ngrok URL, update webhook URL in code. Temporary; disappears when deployed to Cloudflare. |
| **D1 database schema mismatch** | Test migrations locally first. D1 CLI supports schema management. |

## API Routes (Cloudflare Workers)

**Worker Routes:**
- `POST /api/chunks` → Parse chunks, create session, enqueue image jobs, return immediately
- `GET /api/status?sessionId=<id>` → Query D1, return chunk/task state
- `POST /api/webhooks/magnific` → Receive video webhook, update D1, trigger next steps

**Queue Handler:**
- `image-generation` queue → Process one image at a time, call fal.ai, store result, trigger video gen

**Webhook Coordination:**
- Durable Object `session-{sessionId}`: Tracks chunk states, coordinates transitions

## Database Schema (Cloudflare D1)

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE chunks (
  id TEXT NOT NULL,
  sessionId TEXT NOT NULL,
  prompt TEXT,
  imagePrompt TEXT,
  videoPrompt TEXT,
  status TEXT DEFAULT 'submitted',
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (sessionId, id),
  FOREIGN KEY (sessionId) REFERENCES sessions(id)
);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chunkId TEXT NOT NULL,
  sessionId TEXT NOT NULL,
  taskType TEXT,
  status TEXT DEFAULT 'pending',
  resultUrl TEXT,
  errorMessage TEXT,
  errorCode TEXT,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sessionId, chunkId) REFERENCES chunks(sessionId, id)
);

CREATE TABLE queue_jobs (
  id TEXT PRIMARY KEY,
  chunkId TEXT NOT NULL,
  sessionId TEXT NOT NULL,
  jobType TEXT,
  status TEXT DEFAULT 'pending',
  retries INTEGER DEFAULT 0,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sessionId, chunkId) REFERENCES chunks(sessionId, id)
);
```

## Open Questions / Known Unknowns

1. **Cloudflare Queues batch processing** — Can we process multiple chunks' image generation in parallel, or should we enforce sequential processing? (Depends on fal.ai rate limits)

2. **Durable Object billing** — For MVP scale (1-10 concurrent sessions), will Durable Object costs be reasonable? 

3. **D1 migration/deployment** — How to version-control and deploy D1 schema changes as development progresses?

4. **magnific.com webhook retry** — If we return 5xx error, does magnific.com retry? Need to implement idempotency (check if video URL already stored).

5. **Session cleanup in D1** — Should we implement TTL-based deletion of old sessions? D1 doesn't have auto-expiration like some NoSQL databases.

6. **Video URL permanence** — magnific.com URLs: confirmed temporary? How long do they last? Should we download to R2 immediately vs lazy?
