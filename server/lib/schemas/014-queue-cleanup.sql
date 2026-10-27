-- Up
-- Visibility is separate from lifecycle: retain receipts, fairness and failure quarantine.
ALTER TABLE queue ADD COLUMN historyClearedAt INTEGER;
CREATE TABLE queueCleanupState (
  roomId INTEGER PRIMARY KEY REFERENCES rooms(roomId) ON DELETE CASCADE,
  generation INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE queueCleanupReceipts (
  roomId INTEGER NOT NULL REFERENCES rooms(roomId) ON DELETE CASCADE,
  requestId TEXT NOT NULL,
  actorId INTEGER NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('pending','history')),
  throughQueueId INTEGER NOT NULL,
  changedCount INTEGER NOT NULL,
  houseStopped INTEGER NOT NULL CHECK(houseStopped IN (0,1)),
  createdAt INTEGER NOT NULL,
  PRIMARY KEY(roomId,requestId)
);

-- Down
DROP TABLE queueCleanupReceipts;
DROP TABLE queueCleanupState;
ALTER TABLE queue DROP COLUMN historyClearedAt;
