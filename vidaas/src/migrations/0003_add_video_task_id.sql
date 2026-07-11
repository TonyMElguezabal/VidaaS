-- Persist the video provider's task_id so the cron poller can reconcile
-- video-generating chunks by polling for their result.
ALTER TABLE chunks ADD COLUMN videoTaskId TEXT;
