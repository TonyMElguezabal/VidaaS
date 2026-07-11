import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { parseChunks } from './lib/chunk-parser';
import {
  startImageGeneration,
  startVideoGeneration,
  parseFalWebhook,
  checkVideoStatus,
  checkImageStatus,
} from './lib/generation';
import { Chunk, Session, ApiStatus, QueueMessage } from './types';

export type Env = {
  DB: D1Database;
  IMAGE_QUEUE: Queue<QueueMessage>;
  VIDEO_QUEUE: Queue<QueueMessage>;
  R2_BUCKET: R2Bucket;
  WEBHOOK_BASE_URL: string;
  ENVIRONMENT: string;
  FAL_API_KEY?: string;
  RUNNINGHUB_API_KEY?: string;
};

// Seconds to stagger successive image jobs, to avoid rate limits.
const STAGGER_SECONDS = 30;
const MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// HTTP (Hono)
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: Env }>();

app.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type');
  if (c.req.method === 'OPTIONS') {
    return c.text('');
  }
  await next();
});

// POST /api/chunks - Submit chunks for processing
app.post('/api/chunks', async (c) => {
  try {
    const body = await c.req.json<{ chunks: string }>();
    const input = body.chunks;

    if (!input || typeof input !== 'string') {
      return c.json({ error: 'Invalid input. Send JSON with "chunks" field.' }, 400);
    }

    const { chunks, errors } = parseChunks(input);

    if (errors.length > 0) {
      return c.json({ error: 'Validation errors', details: errors }, 400);
    }
    if (chunks.length === 0) {
      return c.json({ error: 'No valid chunks found' }, 400);
    }

    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

    await c.env.DB.prepare(`INSERT INTO sessions (id, expiresAt) VALUES (?, ?)`)
      .bind(sessionId, expiresAt)
      .run();

    // Insert chunks and enqueue image generation with a staggered delay so we
    // don't hit the image API rate limit (parallel, but 30s apart).
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      await c.env.DB.prepare(
        `INSERT INTO chunks (id, sessionId, prompt, imagePrompt, videoPrompt, status)
         VALUES (?, ?, ?, ?, ?, 'submitted')`
      )
        .bind(chunk.id, sessionId, chunk.prompt, chunk.imagePrompt, chunk.videoPrompt)
        .run();

      await c.env.IMAGE_QUEUE.send(
        { type: 'image', chunkId: chunk.id, sessionId },
        { delaySeconds: i * STAGGER_SECONDS }
      );
    }

    return c.json({
      sessionId,
      expiresAt,
      chunksSubmitted: chunks.length,
      chunks: chunks.map((ch) => ({ id: ch.id, prompt: ch.prompt, status: 'submitted' })),
    });
  } catch (error) {
    console.error('Error in POST /api/chunks:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// GET /api/status - Get session status
app.get('/api/status', async (c) => {
  try {
    const sessionId = c.req.query('sessionId');
    if (!sessionId) {
      return c.json({ error: 'Missing sessionId query parameter' }, 400);
    }

    const session = await c.env.DB.prepare('SELECT * FROM sessions WHERE id = ?')
      .bind(sessionId)
      .first<Session>();
    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }

    const chunksResult = await c.env.DB.prepare(
      'SELECT * FROM chunks WHERE sessionId = ? ORDER BY createdAt'
    )
      .bind(sessionId)
      .all<Chunk>();

    const status: ApiStatus = {
      sessionId,
      expiresAt: session.expiresAt,
      chunks: chunksResult.results || [],
    };
    return c.json(status);
  } catch (error) {
    console.error('Error in GET /api/status:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// POST /api/retry - Re-enqueue a failed chunk (manual retry)
app.post('/api/retry', async (c) => {
  try {
    const body = await c.req.json<{ sessionId: string; chunkId: string }>();
    const { sessionId, chunkId } = body;
    if (!sessionId || !chunkId) {
      return c.json({ error: 'sessionId and chunkId are required' }, 400);
    }

    const chunk = await c.env.DB.prepare(
      'SELECT * FROM chunks WHERE id = ? AND sessionId = ?'
    )
      .bind(chunkId, sessionId)
      .first<Chunk>();
    if (!chunk) {
      return c.json({ error: 'Chunk not found' }, 404);
    }

    await c.env.DB.prepare(
      "UPDATE chunks SET status = 'submitted', error = NULL, imageUrl = NULL, videoUrl = NULL, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND sessionId = ?"
    )
      .bind(chunkId, sessionId)
      .run();

    await c.env.IMAGE_QUEUE.send({ type: 'image', chunkId, sessionId });
    return c.json({ success: true, chunkId });
  } catch (error) {
    console.error('Error in POST /api/retry:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// POST /api/webhooks/fal - Receive image completion webhook (fal async queue)
app.post('/api/webhooks/fal', async (c) => {
  try {
    const chunkId = c.req.query('chunkId');
    const sessionId = c.req.query('sessionId');
    const body = await c.req.json();

    if (!chunkId || !sessionId) {
      return c.json({ error: 'Missing chunkId or sessionId in webhook URL' }, 400);
    }

    const chunk = await c.env.DB.prepare(
      'SELECT * FROM chunks WHERE id = ? AND sessionId = ?'
    )
      .bind(chunkId, sessionId)
      .first<Chunk>();
    if (!chunk) {
      return c.json({ error: 'Chunk not found' }, 404);
    }

    // Idempotency: image already recorded.
    if (chunk.imageUrl) {
      return c.json({ success: true, chunkId, imageUrl: chunk.imageUrl, idempotent: true });
    }

    const { url, error } = parseFalWebhook(body);
    if (error || !url) {
      await c.env.DB.prepare(
        "UPDATE chunks SET status = 'failed', error = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND sessionId = ?"
      )
        .bind(error || 'Image generation failed', chunkId, sessionId)
        .run();
      console.warn(`fal webhook: chunk ${chunkId} failed — ${error}`);
      return c.json({ success: false, error }, 200); // 200 so fal doesn't redeliver
    }

    await applyImageResult(c.env, sessionId, chunkId, url, 'webhook');
    return c.json({ success: true, chunkId, imageUrl: url });
  } catch (error) {
    console.error('Error in POST /api/webhooks/fal:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Shared, idempotent image completion used by both the fal webhook and the
// cron reconciler: store the URL, set image-complete, and enqueue the video
// job EXACTLY ONCE (the UPDATE only transitions a chunk still lacking an image).
async function applyImageResult(
  env: Env,
  sessionId: string,
  chunkId: string,
  url: string,
  source: string
): Promise<void> {
  const res = await env.DB.prepare(
    "UPDATE chunks SET imageUrl = ?, status = 'image-complete', updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND sessionId = ? AND imageUrl IS NULL"
  )
    .bind(url, chunkId, sessionId)
    .run();

  if ((res.meta?.changes ?? 0) > 0) {
    await env.VIDEO_QUEUE.send({ type: 'video', chunkId, sessionId, imageUrl: url });
    console.log(`Image complete (${source}) for chunk ${chunkId} → ${url}`);
  }
}

// Note: RunningHub is poll-only (no webhook). Video completion is handled
// entirely by the cron reconciler via checkVideoStatus + applyVideoResult.

app.get('/health', (c) => c.json({ status: 'ok' }));

// Applies a RunningHub video result to a chunk. Used by the cron poller.
// Returns 'complete' | 'failed' | 'pending' | 'error'.
async function applyVideoResult(
  env: Env,
  sessionId: string,
  chunkId: string,
  status: string | undefined,
  videoUrl: string | undefined
): Promise<'complete' | 'failed' | 'pending' | 'error'> {
  const s = (status || '').toUpperCase();
  if (s === 'SUCCESS' && videoUrl) {
    await env.DB.prepare(
      "UPDATE chunks SET videoUrl = ?, status = 'complete', updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND sessionId = ? AND status != 'complete'"
    )
      .bind(videoUrl, chunkId, sessionId)
      .run();
    console.log(`Video complete for chunk ${chunkId} → ${videoUrl}`);
    return 'complete';
  }
  if (s === 'FAILED' || s === 'ERROR') {
    await env.DB.prepare(
      "UPDATE chunks SET status = 'failed', error = 'Video generation failed', updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND sessionId = ?"
    )
      .bind(chunkId, sessionId)
      .run();
    return 'failed';
  }
  // QUEUED / RUNNING / unknown-without-url → still pending.
  return status ? 'pending' : 'error';
}

// ---------------------------------------------------------------------------
// Queue consumers
// ---------------------------------------------------------------------------

async function handleImageJob(msg: QueueMessage, env: Env): Promise<void> {
  const { chunkId, sessionId } = msg;

  const chunk = await env.DB.prepare(
    'SELECT imagePrompt FROM chunks WHERE id = ? AND sessionId = ?'
  )
    .bind(chunkId, sessionId)
    .first<{ imagePrompt: string }>();
  if (!chunk) throw new Error(`Chunk not found: ${sessionId}/${chunkId}`);

  await setStatus(env, sessionId, chunkId, 'image-generating');

  const result = await startImageGeneration(
    { prompt: chunk.imagePrompt, chunkId, sessionId },
    env
  );

  if (result.completedImageUrl) {
    // Mock mode: image is ready now — store it and hand off to video.
    await env.DB.prepare(
      "UPDATE chunks SET imageUrl = ?, status = 'image-complete', updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND sessionId = ?"
    )
      .bind(result.completedImageUrl, chunkId, sessionId)
      .run();
    console.log(`Image complete (mock) for chunk ${chunkId}: ${result.completedImageUrl}`);
    await env.VIDEO_QUEUE.send({ type: 'video', chunkId, sessionId, imageUrl: result.completedImageUrl });
  } else {
    // Production: submitted to fal queue. Completion arrives via /api/webhooks/fal
    // (fast path); the stored request id lets the cron reconciler recover the
    // chunk if that webhook is missed.
    await env.DB.prepare(
      'UPDATE chunks SET imageTaskId = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND sessionId = ?'
    )
      .bind(result.requestId ?? null, chunkId, sessionId)
      .run();
    console.log(`Image generation submitted for chunk ${chunkId}, request ${result.requestId} (awaiting webhook/cron)`);
  }
}

async function handleVideoJob(msg: QueueMessage, env: Env): Promise<void> {
  const { chunkId, sessionId } = msg;

  const chunk = await env.DB.prepare(
    'SELECT imageUrl, videoPrompt, prompt FROM chunks WHERE id = ? AND sessionId = ?'
  )
    .bind(chunkId, sessionId)
    .first<{ imageUrl: string | null; videoPrompt: string; prompt: string }>();
  if (!chunk) throw new Error(`Chunk not found: ${sessionId}/${chunkId}`);
  if (!chunk.imageUrl) throw new Error(`No image for chunk ${chunkId}, cannot generate video`);

  await setStatus(env, sessionId, chunkId, 'video-generating');

  const result = await startVideoGeneration(
    { imageUrl: chunk.imageUrl, prompt: chunk.videoPrompt, spokenPrompt: chunk.prompt, chunkId, sessionId },
    env
  );

  // In mock mode the video is already "done" — complete it now.
  // In production, store the RunningHub task_id; completion is detected by the
  // cron reconciler polling RunningHub (poll-only — no webhook).
  if (result.completedVideoUrl) {
    await env.DB.prepare(
      "UPDATE chunks SET videoUrl = ?, status = 'complete', updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND sessionId = ?"
    )
      .bind(result.completedVideoUrl, chunkId, sessionId)
      .run();
    console.log(`Video complete (mock) for chunk ${chunkId}: ${result.completedVideoUrl}`);
  } else {
    await env.DB.prepare(
      'UPDATE chunks SET videoTaskId = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND sessionId = ?'
    )
      .bind(result.taskId, chunkId, sessionId)
      .run();
    console.log(`Video generation started for chunk ${chunkId}, task ${result.taskId} (awaiting cron poll)`);
  }
}

/**
 * Cron reconciler: find video-generating chunks with a stored RunningHub task_id
 * and poll RunningHub for their result. This is the sole completion path
 * (RunningHub is poll-only — no webhook).
 */
async function reconcileVideos(env: Env): Promise<void> {
  const rows = await env.DB.prepare(
    "SELECT id, sessionId, videoTaskId FROM chunks WHERE status = 'video-generating' AND videoTaskId IS NOT NULL LIMIT 50"
  ).all<{ id: string; sessionId: string; videoTaskId: string }>();

  const chunks = rows.results || [];
  if (chunks.length === 0) return;
  console.log(`Cron: reconciling ${chunks.length} video-generating chunk(s)`);

  for (const chunk of chunks) {
    try {
      const { status, videoUrl } = await checkVideoStatus(chunk.videoTaskId, env);
      await applyVideoResult(env, chunk.sessionId, chunk.id, status, videoUrl);
    } catch (error) {
      console.error(`Cron: failed to check video chunk ${chunk.id}:`, error instanceof Error ? error.message : error);
    }
  }
}

/**
 * Cron reconciler (safety net): recover chunks whose fal image webhook was
 * missed. Only polls chunks stuck in `image-generating` past a ~90s grace
 * period (so the webhook gets first crack). Recovers successes only.
 */
async function reconcileImages(env: Env): Promise<void> {
  const rows = await env.DB.prepare(
    "SELECT id, sessionId, imageTaskId FROM chunks WHERE status = 'image-generating' AND imageTaskId IS NOT NULL AND updatedAt < datetime('now', '-90 seconds') LIMIT 50"
  ).all<{ id: string; sessionId: string; imageTaskId: string }>();

  const chunks = rows.results || [];
  if (chunks.length === 0) return;
  console.log(`Cron: reconciling ${chunks.length} image-generating chunk(s)`);

  for (const chunk of chunks) {
    try {
      const { url } = await checkImageStatus(chunk.imageTaskId, env);
      if (url) {
        await applyImageResult(env, chunk.sessionId, chunk.id, url, 'cron');
      }
    } catch (error) {
      console.error(`Cron: failed to check image chunk ${chunk.id}:`, error instanceof Error ? error.message : error);
    }
  }
}

async function setStatus(env: Env, sessionId: string, chunkId: string, status: string): Promise<void> {
  await env.DB.prepare(
    'UPDATE chunks SET status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND sessionId = ?'
  )
    .bind(status, chunkId, sessionId)
    .run();
}

async function markFailed(env: Env, sessionId: string, chunkId: string, error: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE chunks SET status = 'failed', error = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND sessionId = ?"
  )
    .bind(error, chunkId, sessionId)
    .run();
}

export default {
  fetch: app.fetch,

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(Promise.all([reconcileVideos(env), reconcileImages(env)]));
  },

  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      const msg = message.body;
      try {
        if (batch.queue.startsWith('image-generation')) {
          await handleImageJob(msg, env);
        } else if (batch.queue.startsWith('video-generation')) {
          await handleVideoJob(msg, env);
        } else {
          console.warn('Unknown queue:', batch.queue);
        }
        message.ack();
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(`Queue job failed (${batch.queue}, chunk ${msg.chunkId}, attempt ${message.attempts}):`, errMsg);

        if (message.attempts <= MAX_RETRIES) {
          // Retry same message (same chunkId) with a backoff delay.
          message.retry({ delaySeconds: STAGGER_SECONDS });
        } else {
          await markFailed(env, msg.sessionId, msg.chunkId, errMsg);
          message.ack();
        }
      }
    }
  },
} satisfies ExportedHandler<Env, QueueMessage>;
