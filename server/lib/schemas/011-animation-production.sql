-- Up
CREATE TABLE animationSessions (
  sessionId TEXT PRIMARY KEY,
  roomId INTEGER NOT NULL REFERENCES rooms(roomId) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('OPEN','CLOSING','CLOSED')),
  openedAt INTEGER NOT NULL,
  closedAt INTEGER,
  closingDeadline INTEGER,
  businessDate TEXT NOT NULL,
  openedBy INTEGER NOT NULL
);
CREATE UNIQUE INDEX animation_session_active ON animationSessions(roomId) WHERE status != 'CLOSED';
ALTER TABLE animationInterventions ADD COLUMN origin TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE animationInterventions ADD COLUMN sessionId TEXT;
ALTER TABLE animationInterventions ADD COLUMN sourceEventKey TEXT;
ALTER TABLE animationInterventions ADD COLUMN family TEXT;
ALTER TABLE animationInterventions ADD COLUMN sequenceJSON TEXT NOT NULL DEFAULT '[]';
CREATE UNIQUE INDEX animation_event_once ON animationInterventions(roomId,sourceEventKey) WHERE sourceEventKey IS NOT NULL;
ALTER TABLE animationRoomState ADD COLUMN pendingEventJSON TEXT;
ALTER TABLE animationRoomState ADD COLUMN ambienceJSON TEXT;
ALTER TABLE animationRoomState ADD COLUMN lastOmission TEXT;
CREATE TABLE catalogGenerationJobs (
  jobId TEXT PRIMARY KEY,
  roomId INTEGER NOT NULL REFERENCES rooms(roomId) ON DELETE CASCADE,
  generationKey TEXT NOT NULL,
  configJSON TEXT NOT NULL,
  status TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  startedAt INTEGER,
  finishedAt INTEGER,
  createdBy INTEGER NOT NULL,
  reviewedBy INTEGER,
  reviewedAt INTEGER,
  units REAL NOT NULL,
  unitType TEXT NOT NULL,
  estimatedCost REAL,
  providerRequestId TEXT,
  filename TEXT,
  durationMs INTEGER,
  checksum TEXT,
  error TEXT,
  UNIQUE(roomId,generationKey)
);
-- Down
DROP TABLE catalogGenerationJobs;
ALTER TABLE animationRoomState DROP COLUMN lastOmission;
ALTER TABLE animationRoomState DROP COLUMN ambienceJSON;
ALTER TABLE animationRoomState DROP COLUMN pendingEventJSON;
DROP INDEX animation_event_once;
ALTER TABLE animationInterventions DROP COLUMN sequenceJSON;
ALTER TABLE animationInterventions DROP COLUMN family;
ALTER TABLE animationInterventions DROP COLUMN sourceEventKey;
ALTER TABLE animationInterventions DROP COLUMN sessionId;
ALTER TABLE animationInterventions DROP COLUMN origin;
DROP TABLE animationSessions;
