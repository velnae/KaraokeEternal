-- Up
ALTER TABLE karaokeCallControls ADD COLUMN listeningEnabled INTEGER NOT NULL DEFAULT 0;
CREATE TABLE listeningPresentations (
  roomId INTEGER NOT NULL REFERENCES rooms(roomId),
  queueId INTEGER NOT NULL REFERENCES queue(queueId),
  inputKey TEXT NOT NULL,
  resultId TEXT REFERENCES karaokeCallParts(id),
  signatureId TEXT REFERENCES karaokeCallParts(id),
  startedAt INTEGER,
  PRIMARY KEY(roomId,queueId)
);
-- Down
DROP TABLE listeningPresentations;
ALTER TABLE karaokeCallControls DROP COLUMN listeningEnabled;
