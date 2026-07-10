## Why

Create an AI-powered video generation tool that transforms user-written scripts into animated video sequences. This enables rapid content creation without manual video production, significantly reducing time-to-output for video marketing and educational content.

## What Changes

- **New web application** for uploading structured content chunks (script sections with image/video generation instructions)
- **Automated image generation** from text prompts using fal.ai's Seedream v5 Pro API (16:9 landscape format)
- **Automated video generation** from generated images using magnific.com's kling-v2.5-pro API
- **Asynchronous orchestration** using webhooks to coordinate multi-step generation pipeline without blocking
- **Content storage** leveraging fal.ai CDN for images and Cloudflare R2 for video storage
- **Real-time progress tracking** via SQLite state persistence and UI polling

## Capabilities

### New Capabilities

- `chunk-input-parsing`: Parse user-provided structured chunk input (ID, PROMPT, IMAGE instruction, VIDEO instruction) with validation
- `image-generation`: Generate 16:9 landscape images from text prompts via fal.ai Seedream v5 Pro API
- `video-generation`: Generate videos from images via magnific.com kling-v2.5-pro API with motion/gesture instructions
- `async-orchestration`: Coordinate image → video pipeline using webhook callbacks for state transitions
- `progress-tracking`: Persist chunk/task state to SQLite and expose status API for UI polling
- `content-delivery`: Store generated videos in Cloudflare R2 and serve URLs to UI

## Impact

- **New dependencies**: `next.js`, `react`, `typescript`, `tailwind`, `sqlite3`, `@aws-sdk/client-s3` (for R2), fal.ai SDK, magnific.com API
- **New API routes**: `/api/chunks`, `/api/generate`, `/api/status`, `/api/webhooks/fal`, `/api/webhooks/magnific`
- **New database schema**: chunks, tasks, asset storage tables
- **External service integrations**: fal.ai (image gen), magnific.com (video gen), Cloudflare R2 (storage)
- **Frontend**: Single-page form → progress dashboard with real-time chunk status updates

**Known unknowns requiring POC:**
- Webhook correlation ID mechanism (passing chunk IDs through fal.ai and magnific.com webhook calls)
- Exact webhook payload structure from both services
- Image sizing strategy for 16:9 format across different resolutions
- Whether to use fal.ai CDN directly or download images to R2
