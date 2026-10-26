-- Up
CREATE TABLE animationRoomState (
  roomId INTEGER PRIMARY KEY REFERENCES rooms(roomId) ON DELETE CASCADE,
  playerEpoch INTEGER NOT NULL DEFAULT 0,
  controlVersion INTEGER NOT NULL DEFAULT 0,
  microphoneOccupied INTEGER NOT NULL DEFAULT 0,
  blockedUntil INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE animationInterventions (
  interventionId TEXT PRIMARY KEY,
  roomId INTEGER NOT NULL REFERENCES rooms(roomId) ON DELETE CASCADE,
  requestId TEXT NOT NULL,
  requestedByUserId INTEGER NOT NULL,
  clipId TEXT NOT NULL,
  clipChecksum TEXT NOT NULL,
  displayText TEXT NOT NULL,
  durationMs INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDING','RESERVED','PLAYING','PLAYED','CANCELLED','EXPIRED','FAILED','INTERRUPTED','UNCERTAIN')),
  playerEpoch INTEGER,
  ownerSocketId TEXT,
  contextKey TEXT,
  transitionId TEXT,
  requestedAt INTEGER NOT NULL,
  expiresAt INTEGER NOT NULL,
  startBefore INTEGER,
  leaseUntil INTEGER,
  startedAt INTEGER,
  finishedAt INTEGER,
  stopRequestedAt INTEGER,
  reason TEXT,
  UNIQUE(roomId, requestedByUserId, requestId)
);
CREATE UNIQUE INDEX animation_one_active ON animationInterventions(roomId)
  WHERE status IN ('PENDING','RESERVED','PLAYING');
CREATE INDEX animation_history ON animationInterventions(roomId, requestedAt DESC);
-- Down
DROP TABLE animationInterventions;
DROP TABLE animationRoomState;
