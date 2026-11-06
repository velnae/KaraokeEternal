-- Up
ALTER TABLE queue ADD COLUMN replacesQueueId INTEGER REFERENCES queue(queueId) ON DELETE SET NULL;
CREATE UNIQUE INDEX queue_replacement ON queue(replacesQueueId) WHERE replacesQueueId IS NOT NULL;

-- Down
DROP INDEX queue_replacement;
ALTER TABLE queue DROP COLUMN replacesQueueId;
