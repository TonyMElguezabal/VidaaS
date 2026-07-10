-- Add error column to chunks for storing failure details
ALTER TABLE chunks ADD COLUMN error TEXT;
