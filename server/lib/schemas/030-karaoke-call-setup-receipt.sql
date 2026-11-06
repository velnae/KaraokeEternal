-- Up
-- If column missing: karaokeCallControls.setupRequestId
ALTER TABLE karaokeCallControls ADD COLUMN setupRequestId TEXT;
-- Down
-- Compatibility field: newer versions of migration 027 already own this column.
