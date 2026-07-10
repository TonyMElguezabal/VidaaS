import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { parseChunks } from './lib/chunk-parser';
import { generateImage, startVideoGeneration } from './lib/generation';
import { Chunk, Session, ApiStatus, QueueMessage } from './types';

export type Env = {
  DB: D1Database;
  IMAGE_QUEUE: Queue<QueueMessage>;
  VIDEO_QUEUE: Queue<QueueMessage>;
  R2_BUCKET: R2Bucket;
  WEBHOOK_BASE_URL: string;
  ENVIRONMENT: string;
  FAL_API_KEY?: string;
  MAGNIFIC_API_KEY?: string;
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

// POST /api/webhooks/magnific - Receive video completion webhook
app.post('/api/webhooks/magnific', async (c) => {
  try {
    const chunkId = c.req.query('chunkId');
    const sessionId = c.req.query('sessionId');
    const body = await c.req.json();

    if (!chunkId || !sessionId) {
      return c.json({ error: 'Missing chunkId or sessionId in webhook URL' }, 400);
    }

    const videoUrl = body?.data?.generated?.[0]?.url;
    if (!videoUrl) {
      return c.json({ error: 'No video URL in webhook payload' }, 400);
    }

    const chunk = await c.env.DB.prepare(
      'SELECT * FROM chunks WHERE id = ? AND sessionId = ?'
    )
      .bind(chunkId, sessionId)
      .first<Chunk>();
    if (!chunk) {
      return c.json({ error: 'Chunk not found' }, 404);
    }

    // Idempotency: if already complete with a video, don't reprocess.
    if (chunk.status === 'complete' && chunk.videoUrl) {
      return c.json({ success: true, chunkId, videoUrl: chunk.videoUrl, idempotent: true });
    }

    await c.env.DB.prepare(
      "UPDATE chunks SET videoUrl = ?, status = 'complete', updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND sessionId = ?"
    )
      .bind(videoUrl, chunkId, sessionId)
      .run();

    console.log(`Video webhook: chunk ${chunkId} complete → ${videoUrl}`);
    return c.json({ success: true, chunkId, videoUrl });
  } catch (error) {
    console.error('Error in POST /api/webhooks/magnific:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.get('/health', (c) => c.json({ status: 'ok' }));

// ---------------------------------------------------------------------------
// Queue consumers
// ---------------------------------------------------------------------------

async function handleImageJob(msg: QueueMessage, env: Env): Promise<void> {
  const { chunkId, sessionId } = msg;

  const chunk = await env.DB.prepare(
    'SELECT imagePrompt, videoPrompt FROM chunks WHERE id = ? AND sessionId = ?'
  )
    .bind(chunkId, sessionId)
    .first<{ imagePrompt: string; videoPrompt: string }>();
  if (!chunk) throw new Error(`Chunk not found: ${sessionId}/${chunkId}`);

  await setStatus(env, sessionId, chunkId, 'image-generating');

  const imageUrl = await generateImage(chunk.imagePrompt, env);

  await env.DB.prepare(
    "UPDATE chunks SET imageUrl = ?, status = 'image-complete', updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND sessionId = ?"
  )
    .bind(imageUrl, chunkId, sessionId)
    .run();
  console.log(`Image complete for chunk ${chunkId}: ${imageUrl}`);

  // Hand off to video generation.
  await env.VIDEO_QUEUE.send({ type: 'video', chunkId, sessionId, imageUrl });
}

async function handleVideoJob(msg: QueueMessage, env: Env): Promise<void> {
  const { chunkId, sessionId } = msg;

  const chunk = await env.DB.prepare(
    'SELECT imageUrl, videoPrompt FROM chunks WHERE id = ? AND sessionId = ?'
  )
    .bind(chunkId, sessionId)
    .first<{ imageUrl: string | null; videoPrompt: string }>();
  if (!chunk) throw new Error(`Chunk not found: ${sessionId}/${chunkId}`);
  if (!chunk.imageUrl) throw new Error(`No image for chunk ${chunkId}, cannot generate video`);

  await setStatus(env, sessionId, chunkId, 'video-generating');

  const result = await startVideoGeneration(
    { imageUrl: chunk.imageUrl, prompt: chunk.videoPrompt, chunkId, sessionId },
    env
  );

  // In mock mode the video is already "done" — complete it now.
  // In production, completion arrives via the magnific webhook.
  if (result.completedVideoUrl) {
    await env.DB.prepare(
      "UPDATE chunks SET videoUrl = ?, status = 'complete', updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND sessionId = ?"
    )
      .bind(result.completedVideoUrl, chunkId, sessionId)
      .run();
    console.log(`Video complete (mock) for chunk ${chunkId}: ${result.completedVideoUrl}`);
  } else {
    console.log(`Video generation started for chunk ${chunkId}, task ${result.taskId} (awaiting webhook)`);
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
