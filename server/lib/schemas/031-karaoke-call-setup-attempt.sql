-- Up
-- If column missing: karaokeCallControls.setupAttempt
ALTER TABLE karaokeCallControls ADD COLUMN setupAttempt INTEGER NOT NULL DEFAULT 0;
-- Down
-- Compatibility field: newer versions of migration 027 already own this column.
