import { FalAiResponse } from '../types';

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

// Mock video task id for local (mock-mode) video generation.
export function getMockVideoTaskId(): string {
  return `mock-task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
