-- Up
ALTER TABLE queue ADD COLUMN requestId TEXT;
CREATE UNIQUE INDEX queue_request_receipt ON queue (roomId, userId, requestId) WHERE requestId IS NOT NULL;

-- Down
DROP INDEX queue_request_receipt;
ALTER TABLE queue DROP COLUMN requestId;
