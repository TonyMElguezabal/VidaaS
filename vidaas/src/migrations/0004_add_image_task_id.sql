-- Persist the fal.ai image request_id so the cron reconciler can poll fal
-- for the result if the image webhook is missed.
ALTER TABLE chunks ADD COLUMN imageTaskId TEXT;
