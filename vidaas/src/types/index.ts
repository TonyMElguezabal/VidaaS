export interface Chunk {
  id: string;
  sessionId: string;
  prompt: string;
  imagePrompt: string;
  videoPrompt: string;
  status: ChunkStatus;
  imageUrl?: string;
  videoUrl?: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export type ChunkStatus =
  | 'submitted'
  | 'image-generating'
  | 'image-complete'
  | 'video-generating'
  | 'complete'
  | 'failed';

export interface Session {
  id: string;
  createdAt: string;
  expiresAt: string;
}

export interface Task {
  id: number;
  chunkId: string;
  sessionId: string;
  taskType: 'image' | 'video';
  status: TaskStatus;
  resultUrl?: string;
  errorMessage?: string;
  errorCode?: string;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface QueueMessage {
  type: 'image' | 'video';
  chunkId: string;
  sessionId: string;
  imageUrl?: string;
  retryCount?: number;
}

export interface FalAiResponse {
  data: {
    images: Array<{
      url: string;
      content_type: string;
      file_name: string;
      file_size: number;
      width?: number;
      height?: number;
    }>;
  };
  requestId: string;
}

export interface MagnificResponse {
  data: {
    task_id: string;
    status: string;
    generated?: Array<{
      url: string;
    }>;
  };
}

export interface ApiStatus {
  sessionId: string;
  expiresAt: string;
  chunks: Chunk[];
}
