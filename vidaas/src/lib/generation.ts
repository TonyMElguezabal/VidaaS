import { FalAiResponse, MagnificResponse } from '../types';
import { getMockFalAiResponse, getMockMagnificResponse } from './mocks';

export interface GenerationEnv {
  ENVIRONMENT: string;
  WEBHOOK_BASE_URL: string;
  FAL_API_KEY?: string;
  MAGNIFIC_API_KEY?: string;
}

const useMocks = (env: GenerationEnv) => env.ENVIRONMENT !== 'production';

/**
 * Generate an image from a text prompt via fal.ai Seedream v5 Pro.
 * Returns the image URL. Uses mocks unless ENVIRONMENT=production.
 */
export async function generateImage(prompt: string, env: GenerationEnv): Promise<string> {
  if (useMocks(env)) {
    console.log('[mock] generateImage:', prompt.slice(0, 60));
    await new Promise((r) => setTimeout(r, 500));
    return getMockFalAiResponse().data.images[0].url;
  }

  const response = await fetch('https://fal.run/fal-ai/bytedance/seedream/v5/pro/text-to-image', {
    method: 'POST',
    headers: {
      Authorization: `Key ${env.FAL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      image_size: { width: 1920, height: 1080 },
      num_images: 1,
      output_format: 'jpeg',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`fal.ai error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as FalAiResponse;
  const url = data.data?.images?.[0]?.url;
  if (!url) throw new Error('fal.ai returned no image URL');
  return url;
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
