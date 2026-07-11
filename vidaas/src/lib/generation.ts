import { MagnificResponse } from '../types';
import { getMockFalAiResponse, getMockMagnificResponse } from './mocks';

export interface GenerationEnv {
  ENVIRONMENT: string;
  WEBHOOK_BASE_URL: string;
  FAL_API_KEY?: string;
  MAGNIFIC_API_KEY?: string;
}

const useMocks = (env: GenerationEnv) => env.ENVIRONMENT !== 'production';

const FAL_MODEL = 'bytedance/seedream/v5/pro/text-to-image';

export interface ImageGenerationResult {
  /**
   * Present only in mock mode: the image is "already done" so the queue
   * consumer can proceed immediately. In production this is undefined and
   * completion arrives asynchronously via POST /api/webhooks/fal.
   */
  completedImageUrl?: string;
  requestId?: string;
}

/**
 * Start image generation via fal.ai Seedream v5 Pro.
 *
 * Production uses fal's ASYNC queue endpoint (`queue.fal.run`) with a
 * `fal_webhook`, not the synchronous `fal.run` endpoint — the sync endpoint
 * holds the connection open until the (slow) image finishes and reliably
 * times out with a 524. fal calls our webhook when the image is ready.
 */
export async function startImageGeneration(
  params: { prompt: string; chunkId: string; sessionId: string },
  env: GenerationEnv
): Promise<ImageGenerationResult> {
  if (useMocks(env)) {
    console.log('[mock] startImageGeneration:', params.prompt.slice(0, 60));
    await new Promise((r) => setTimeout(r, 500));
    return { completedImageUrl: getMockFalAiResponse().data.images[0].url };
  }

  const webhookUrl = buildFalWebhookUrl(env.WEBHOOK_BASE_URL, params.sessionId, params.chunkId);
  const submitUrl = `https://queue.fal.run/${FAL_MODEL}?fal_webhook=${encodeURIComponent(webhookUrl)}`;

  const response = await fetch(submitUrl, {
    method: 'POST',
    headers: {
      Authorization: `Key ${env.FAL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: params.prompt,
      image_size: { width: 1920, height: 1080 },
      num_images: 1,
      output_format: 'jpeg',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`fal.ai submit error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as { request_id?: string };
  return { requestId: data.request_id };
}

/**
 * Extract the image URL from a fal.ai webhook payload.
 * fal posts: { request_id, status: "OK"|"ERROR", payload: { images: [{url}] }, error }
 * Returns { url } on success or { error } on failure.
 */
export function parseFalWebhook(body: any): { url?: string; error?: string } {
  if (body?.status && body.status !== 'OK') {
    return { error: typeof body.error === 'string' ? body.error : JSON.stringify(body.error ?? body.payload_error ?? 'fal error') };
  }
  const url = body?.payload?.images?.[0]?.url ?? body?.images?.[0]?.url;
  if (!url) return { error: 'fal webhook contained no image URL' };
  return { url };
}

export function buildFalWebhookUrl(baseUrl: string, sessionId: string, chunkId: string): string {
  const url = new URL('/api/webhooks/fal', baseUrl);
  url.searchParams.set('sessionId', sessionId);
  url.searchParams.set('chunkId', chunkId);
  return url.toString();
}

export interface VideoGenerationResult {
  taskId: string;
  /**
   * Present only in mock mode: the video is "already done" so the queue
   * consumer can complete the chunk immediately without a real webhook.
   * In production this is undefined and completion arrives via webhook.
   */
  completedVideoUrl?: string;
}

/**
 * Kick off video generation via magnific.com kling-v2.5-pro.
 * In production the result arrives asynchronously via webhook (returns taskId only).
 * In mock mode returns a completedVideoUrl so the pipeline finishes locally.
 */
export async function startVideoGeneration(
  params: { imageUrl: string; prompt: string; chunkId: string; sessionId: string },
  env: GenerationEnv
): Promise<VideoGenerationResult> {
  if (useMocks(env)) {
    console.log('[mock] startVideoGeneration for chunk', params.chunkId);
    await new Promise((r) => setTimeout(r, 500));
    const taskId = getMockMagnificResponse().data.task_id;
    return {
      taskId,
      completedVideoUrl: `https://mock.magnific.com/videos/${taskId}.mp4`,
    };
  }

  const webhookUrl = buildMagnificWebhookUrl(env.WEBHOOK_BASE_URL, params.sessionId, params.chunkId);
  const response = await fetch('https://api.magnific.com/v1/ai/image-to-video/kling-v2-5-pro', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-magnific-api-key': env.MAGNIFIC_API_KEY ?? '',
    },
    body: JSON.stringify({
      webhook_url: webhookUrl,
      image: params.imageUrl,
      prompt: params.prompt,
      negative_prompt: 'low quality, blurry, distorted',
      cfg_scale: 0.5,
      duration: '5',
      resolution: '720p',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`magnific.com error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as MagnificResponse;
  const taskId = data.data?.task_id;
  if (!taskId) throw new Error('magnific.com returned no task_id');
  return { taskId };
}

export function buildMagnificWebhookUrl(baseUrl: string, sessionId: string, chunkId: string): string {
  const url = new URL('/api/webhooks/magnific', baseUrl);
  url.searchParams.set('sessionId', sessionId);
  url.searchParams.set('chunkId', chunkId);
  return url.toString();
}

/**
 * Parse a magnific.com task result. Tolerant of both shapes:
 *  - GET status:  { data: { task_id, status, generated: ["<url>"] } }
 *  - webhook:     { task_id, status, generated: ["<url>"] }   (no data wrapper)
 * `generated` items are plain URL strings (older shapes used { url }).
 */
export function parseMagnificResult(body: any): { status?: string; videoUrl?: string } {
  const d = body?.data ?? body;
  const first = d?.generated?.[0];
  const videoUrl = typeof first === 'string' ? first : first?.url;
  return { status: d?.status, videoUrl };
}

/**
 * Poll magnific.com for a task's current status/result.
 * Used by the cron reconciler as the authoritative completion path.
 */
export async function checkVideoStatus(
  taskId: string,
  env: GenerationEnv
): Promise<{ status?: string; videoUrl?: string }> {
  const response = await fetch(
    `https://api.magnific.com/v1/ai/image-to-video/kling-v2-5-pro/${taskId}`,
    { headers: { 'x-magnific-api-key': env.MAGNIFIC_API_KEY ?? '' } }
  );
  if (!response.ok) {
    throw new Error(`magnific.com status error ${response.status}`);
  }
  return parseMagnificResult(await response.json());
}
