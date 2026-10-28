-- Up
CREATE TABLE audioUsage (
  roomId INTEGER NOT NULL REFERENCES rooms(roomId) ON DELETE CASCADE,
  sourceId TEXT NOT NULL,
  clipId TEXT NOT NULL,
  sourceType TEXT NOT NULL CHECK(sourceType IN ('intervention','ambience')),
  sessionId TEXT,
  businessDate TEXT NOT NULL,
  startedAt INTEGER NOT NULL,
  PRIMARY KEY(roomId,sourceId,clipId)
);
CREATE INDEX audio_usage_inventory ON audioUsage(roomId,clipId,businessDate,startedAt);
-- Down
DROP TABLE audioUsage;
