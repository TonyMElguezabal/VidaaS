import { getMockFalAiResponse, getMockMagnificResponse } from '../lib/mocks';
import { QueueMessage, FalAiResponse, MagnificResponse } from '../types';

type Bindings = {
  DB: D1Database;
  VIDEO_QUEUE: Queue<QueueMessage>;
  WEBHOOK_BASE_URL: string;
  ENVIRONMENT: string;
  FAL_API_KEY?: string;
  MAGNIFIC_API_KEY?: string;
};

export default {
  async queue(batch: MessageBatch<QueueMessage>, env: Bindings) {
    for (const message of batch.messages) {
      try {
        await processImageGeneration(message.body, env, batch);
      } catch (error) {
        console.error(`Failed to process image for chunk ${message.body.chunkId}:`, error);
        if ((message.body.retryCount || 0) < 3) {
          // Re-enqueue with incremented retry count
          const retryMessage: QueueMessage = {
            ...message.body,
            retryCount: (message.body.retryCount || 0) + 1,
          };
          console.log(`Retrying image generation for chunk ${message.body.chunkId}, attempt ${retryMessage.retryCount}`);
          // Note: In a real implementation, we'd re-enqueue after a delay
          // For now, we'll just mark as failed
          await markChunkFailed(message.body.chunkId, message.body.sessionId, env, 'Max retries exceeded');
        } else {
          await markChunkFailed(message.body.chunkId, message.body.sessionId, env, 'Image generation failed after retries');
        }
      }
    }
  },
} satisfies ExportedHandler<Bindings, QueueMessage>;

async function processImageGeneration(msg: QueueMessage, env: Bindings, batch: MessageBatch<QueueMessage>) {
  const { chunkId, sessionId, retryCount = 0 } = msg;

  console.log(`Processing image generation for chunk ${chunkId} (attempt ${retryCount + 1})`);

  // Get chunk details
  const chunkResult = await env.DB.prepare(
    'SELECT imagePrompt FROM chunks WHERE id = ? AND sessionId = ?'
  ).bind(chunkId, sessionId).first<{ imagePrompt: string }>();

  if (!chunkResult) {
    throw new Error(`Chunk not found: ${chunkId}`);
  }

  // Update status to image-generating
  await env.DB.prepare(
    'UPDATE chunks SET status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND sessionId = ?'
  ).bind('image-generating', chunkId, sessionId).run();

  // Call fal.ai API (or mock)
  let imageUrl: string;

  if (env.ENVIRONMENT === 'production' && env.FAL_API_KEY) {
    // Real API call
    imageUrl = await callFalAiApi(chunkResult.imagePrompt, env.FAL_API_KEY);
  } else {
    // Mock for development
    console.log('Using mock fal.ai response');
    const response = getMockFalAiResponse();
    imageUrl = response.data.images[0].url;
    // Simulate processing time
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // Update chunk with image URL
  await env.DB.prepare(
    'UPDATE chunks SET imageUrl = ?, status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND sessionId = ?'
  ).bind(imageUrl, 'image-complete', chunkId, sessionId).run();

  console.log(`Image generated for chunk ${chunkId}: ${imageUrl}`);

  // Now trigger video generation
  await env.VIDEO_QUEUE.send({
    type: 'video',
    chunkId,
    sessionId,
    imageUrl,
    retryCount: 0,
  });

  // Acknowledge successful processing
  batch.ack();
}

async function callFalAiApi(prompt: string, apiKey: string): Promise<string> {
  // Split API key into key:secret
  const [keyPart, secretPart] = apiKey.split(':');
  const authHeader = Buffer.from(`${keyPart}:${secretPart}`).toString('base64');

  const response = await fetch('https://api.fal.ai/v1/seedream-v5-pro', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${authHeader}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      image_size: {
        width: 1920,
        height: 1080,
      },
      num_images: 1,
      output_format: 'jpeg',
    }),
  });

  if (!response.ok) {
    throw new Error(`fal.ai API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as FalAiResponse;
  return data.data.images[0].url;
}

async function markChunkFailed(chunkId: string, sessionId: string, env: Bindings, errorMessage: string) {
  await env.DB.prepare(
    'UPDATE chunks SET status = ?, error = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND sessionId = ?'
  ).bind('failed', errorMessage, chunkId, sessionId).run();
}
