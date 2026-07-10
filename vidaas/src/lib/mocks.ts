import { FalAiResponse, MagnificResponse } from '../types';

// Mock responses based on POC results
export function getMockFalAiResponse(): FalAiResponse {
  return {
    data: {
      images: [
        {
          url: `https://v3b.fal.media/files/mock/${Math.random().toString(36).slice(2)}.jpg`,
          content_type: 'image/jpeg',
          file_name: `mock-${Date.now()}.jpg`,
          file_size: 374322,
          width: 1920,
          height: 1080,
        },
      ],
    },
    requestId: `mock-req-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  };
}

export function getMockMagnificResponse(): MagnificResponse {
  return {
    data: {
      task_id: `mock-task-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      status: 'CREATED',
      generated: [],
    },
  };
}

export function getMockMagnificWebhookPayload(taskId: string): {
  data: {
    task_id: string;
    status: string;
    generated: Array<{ url: string }>;
  };
} {
  return {
    data: {
      task_id: taskId,
      status: 'COMPLETED',
      generated: [
        {
          url: `https://example.magnific.com/videos/mock/${Math.random().toString(36).slice(2)}.mp4`,
        },
      ],
    },
  };
}
