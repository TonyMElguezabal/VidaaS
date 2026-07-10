import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { parseChunks } from './lib/chunk-parser';
import { Chunk, Session, ApiStatus, QueueMessage } from './types';

type Bindings = {
  DB: D1Database;
  IMAGE_QUEUE: Queue<QueueMessage>;
  VIDEO_QUEUE: Queue<QueueMessage>;
  R2_BUCKET: R2Bucket;
  WEBHOOK_BASE_URL: string;
  ENVIRONMENT: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Middleware to add CORS
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

    // Parse chunks
    const { chunks, errors } = parseChunks(input);

    if (errors.length > 0) {
      return c.json({ error: 'Validation errors', details: errors }, 400);
    }

    if (chunks.length === 0) {
      return c.json({ error: 'No valid chunks found' }, 400);
    }

    // Create session
    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

    // Insert session
    await c.env.DB.prepare(
      `INSERT INTO sessions (id, expiresAt) VALUES (?, ?)`
    ).bind(sessionId, expiresAt).run();

    // Insert chunks and enqueue image generation
    for (const chunk of chunks) {
      await c.env.DB.prepare(
        `INSERT INTO chunks (id, sessionId, prompt, imagePrompt, videoPrompt, status)
         VALUES (?, ?, ?, ?, ?, 'submitted')`
      ).bind(chunk.id, sessionId, chunk.prompt, chunk.imagePrompt, chunk.videoPrompt).run();

      // Enqueue image generation job
      await c.env.IMAGE_QUEUE.send({
        type: 'image',
        chunkId: chunk.id,
        sessionId,
        retryCount: 0,
      });
    }

    return c.json({
      sessionId,
      expiresAt,
      chunksSubmitted: chunks.length,
      chunks: chunks.map((c) => ({
        id: c.id,
        prompt: c.prompt,
        status: 'submitted',
      })),
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

    // Get session
    const sessionResult = await c.env.DB.prepare(
      'SELECT * FROM sessions WHERE id = ?'
    ).bind(sessionId).first<Session>();

    if (!sessionResult) {
      return c.json({ error: 'Session not found' }, 404);
    }

    // Get chunks
    const chunksResult = await c.env.DB.prepare(
      'SELECT * FROM chunks WHERE sessionId = ?'
    ).bind(sessionId).all<Chunk>();

    const chunks = chunksResult.results || [];

    const status: ApiStatus = {
      sessionId,
      expiresAt: sessionResult.expiresAt,
      chunks,
    };

    return c.json(status);
  } catch (error) {
    console.error('Error in GET /api/status:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// POST /api/webhooks/magnific - Receive video completion webhook
app.post('/api/webhooks/magnific', async (c) => {
  try {
    const chunkId = c.req.query('chunkId');
    const body = await c.req.json();

    if (!chunkId) {
      return c.json({ error: 'Missing chunkId in webhook URL' }, 400);
    }

    const videoUrl = body.data?.generated?.[0]?.url;
    if (!videoUrl) {
      return c.json({ error: 'No video URL in webhook payload' }, 400);
    }

    // Find the chunk to get sessionId
    const chunkResult = await c.env.DB.prepare(
      'SELECT * FROM chunks WHERE id = ? LIMIT 1'
    ).bind(chunkId).first<Chunk>();

    if (!chunkResult) {
      return c.json({ error: 'Chunk not found' }, 404);
    }

    // Update chunk with video URL and status
    await c.env.DB.prepare(
      'UPDATE chunks SET videoUrl = ?, status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND sessionId = ?'
    ).bind(videoUrl, 'complete', chunkId, chunkResult.sessionId).run();

    console.log(`Video webhook received for chunk ${chunkId}, video URL: ${videoUrl}`);

    return c.json({ success: true, chunkId, videoUrl });
  } catch (error) {
    console.error('Error in POST /api/webhooks/magnific:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

export default app;
