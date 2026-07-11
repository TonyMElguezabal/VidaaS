-- Persist the magnific.com task_id so the cron poller can reconcile
-- video-generating chunks even if the webhook never arrives.
ALTER TABLE chunks ADD COLUMN videoTaskId TEXT;
