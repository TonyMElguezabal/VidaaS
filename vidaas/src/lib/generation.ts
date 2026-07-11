import { getMockFalAiResponse, getMockVideoTaskId } from './mocks';

export interface GenerationEnv {
  ENVIRONMENT: string;
  WEBHOOK_BASE_URL: string;
  FAL_API_KEY?: string;
  RUNNINGHUB_API_KEY?: string;
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

const RUNNINGHUB_SUBMIT = 'https://www.runninghub.ai/openapi/v2/rhart-video-g/image-to-video';
const RUNNINGHUB_QUERY = 'https://www.runninghub.ai/openapi/v2/query';

/**
 * Kick off video generation via RunningHub (rhart-video-g/image-to-video).
 * Poll-only — completion is detected by the cron reconciler via checkVideoStatus.
 * In mock mode returns a completedVideoUrl so the pipeline finishes locally.
 */
export async function startVideoGeneration(
  params: { imageUrl: string; prompt: string; chunkId: string; sessionId: string },
  env: GenerationEnv
): Promise<VideoGenerationResult> {
  if (useMocks(env)) {
    console.log('[mock] startVideoGeneration for chunk', params.chunkId);
    await new Promise((r) => setTimeout(r, 500));
    const taskId = getMockVideoTaskId();
    return {
      taskId,
      completedVideoUrl: `https://mock.runninghub.ai/videos/${taskId}.mp4`,
    };
  }

  const response = await fetch(RUNNINGHUB_SUBMIT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.RUNNINGHUB_API_KEY ?? ''}`,
    },
    body: JSON.stringify({
      prompt: params.prompt,
      aspectRatio: '16:9',
      imageUrls: [params.imageUrl],
      resolution: '720p',
      duration: 6,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`RunningHub error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    taskId?: string;
    status?: string;
    errorCode?: string;
    errorMessage?: string;
  };
  if (data.errorCode) {
    throw new Error(`RunningHub error ${data.errorCode}: ${data.errorMessage || ''}`);
  }
  if (!data.taskId) throw new Error('RunningHub returned no taskId');
  return { taskId: data.taskId };
}

interface RunningHubResult {
  url?: string;
  outputType?: string;
  text?: string | null;
}

/**
 * Parse a RunningHub /query response. Picks the mp4 result (fallback: first).
 * Statuses: QUEUED | RUNNING | SUCCESS | FAILED.
 */
export function parseRunningHubResult(body: any): { status?: string; videoUrl?: string } {
  const results: RunningHubResult[] = Array.isArray(body?.results) ? body.results : [];
  const mp4 = results.find((r) => r.outputType === 'mp4') ?? results[0];
  return { status: body?.status, videoUrl: mp4?.url };
}

/**
 * Poll RunningHub for a task's current status/result.
 * Used by the cron reconciler as the authoritative (and only) completion path.
 */
export async function checkVideoStatus(
  taskId: string,
  env: GenerationEnv
): Promise<{ status?: string; videoUrl?: string }> {
  const response = await fetch(RUNNINGHUB_QUERY, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.RUNNINGHUB_API_KEY ?? ''}`,
    },
    body: JSON.stringify({ taskId }),
  });
  if (!response.ok) {
    throw new Error(`RunningHub status error ${response.status}`);
  }
  return parseRunningHubResult(await response.json());
}
