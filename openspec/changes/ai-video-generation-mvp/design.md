## Context

This MVP addresses rapid AI-driven video generation from user-provided scripts. Current state: no video generation capability exists. The system must orchestrate async multi-step generation (image → video) using third-party APIs with webhook callbacks for state transitions. Primary constraint: simplicity and speed-to-market over feature completeness.

## Goals / Non-Goals

**Goals:**
- Enable end-to-end video generation from structured script chunks in a single session
- Implement async orchestration pattern using webhooks for non-blocking multi-step workflows
- Provide real-time progress visibility to users via polling
- Persist state to SQLite for reliability across server restarts
- Demonstrate proof-of-concept for webhook correlation ID mechanism with fal.ai and magnific.com

**Non-Goals:**
- Persistent user accounts or authentication (MVP is public/sessionless)
- Batch job persistence across multiple sessions
- Advanced retry/recovery strategies (fail fast, report to user)
- Video hosting/streaming (rely on CDN URLs from services)
- Support for custom parameters (fixed 16:9 landscape, 5s duration, fixed cfg_scale)

## Decisions

### Decision 1: Architecture - Serverless-first with SQLite state

**Choice:** Next.js App Router with in-process SQLite, no separate backend service.

**Rationale:** Simplest deployment model for MVP. No need for queue system (Redis/RabbitMQ) or separate worker service. Webhooks are handled as HTTP POST → state update → API call to next service in sequence.

**Alternatives Considered:**
- Full microservices with job queue (Bull/BullMQ): Overkill for MVP, adds operational complexity
- Pure in-memory state: Loses state on restart, unacceptable for long-running video generation
- External database (PostgreSQL): Adds deployment dependency, SQLite sufficient for MVP scale

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

**Choice:** If any API call fails (fal.ai/magnific.com), mark chunk as failed with error details in SQLite. UI displays error. No automatic retry.

**Rationale:** MVP scope. Retry logic can be added later. Gives user visibility into failures immediately.

**Alternatives Considered:**
- Exponential backoff retry: Adds queuing complexity, can mask real issues
- Partial failure recovery: Out of scope (e.g., retry only fal.ai, not magnific.com)

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| **Webhook correlation mechanism fails** (fal.ai/magnific.com don't support passing IDs in webhook URL) | POC must verify this before building. If it fails, switch to storing request IDs in database and querying on webhook receipt. |
| **Webhook never arrives** (network failure, service outage) | User sees "processing" indefinitely. Add UI timeout (5-15 min) to alert user. Can add manual retry button later. |
| **Video generation takes much longer than expected** (> 15 min) | Polling will continue but UI may feel unresponsive. Document expected duration. Consider adding timeout with manual check link. |
| **Cloudflare R2 upload fails** | Video stored only on magnific.com temporary URL. Mitigation: Implement retry, or fall back to storing temp URL in SQLite with note about expiration. |
| **Database file grows unbounded** | SQLite database accumulates sessions indefinitely. For MVP, acceptable. Future: add TTL-based cleanup (e.g., delete sessions > 30 days). |
| **Multiple chunks trigger video generation simultaneously** | potential rate-limiting from magnific.com. Mitigation: Implement sequential video generation (only one at a time) to stay within API quotas. |

## API Routes

- `POST /api/chunks`: Parse and validate chunk input, create session, return sessionId + chunks
- `GET /api/status?sessionId=<id>`: Return current state of all chunks in session
- `POST /api/webhooks/fal`: Receive image generation completion, store image URL, trigger video generation
- `POST /api/webhooks/magnific`: Receive video generation completion, store video URL

## Database Schema (SQLite)

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE chunks (
  id TEXT,
  sessionId TEXT,
  prompt TEXT,
  imagePrompt TEXT,
  videoPrompt TEXT,
  status TEXT (submitted|image-generating|image-complete|video-generating|complete|failed),
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (sessionId, id),
  FOREIGN KEY (sessionId) REFERENCES sessions(id)
);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chunkId TEXT,
  sessionId TEXT,
  taskType TEXT (image|video),
  status TEXT (pending|processing|completed|failed),
  resultUrl TEXT,
  errorMessage TEXT,
  errorCode TEXT,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sessionId, chunkId) REFERENCES chunks(sessionId, id)
);
```

## Open Questions

1. **Exact webhook correlation mechanism for fal.ai and magnific.com** — Requires POC with test API calls to confirm query parameter passing
2. **magnific.com video URL persistence** — Are returned video URLs permanent or temporary? If temporary, what's the TTL?
3. **fal.ai image sizing** — What exact parameter/preset name for 16:9 1920x1080? (e.g., `{ width: 1920, height: 1080 }` vs preset constant)
4. **Video generation rate limiting** — Does magnific.com have per-second/per-minute quotas? Should we throttle concurrent requests?
5. **Webhook retry behavior** — If we return non-2xx status, do services retry? Should we implement idempotency checks?
