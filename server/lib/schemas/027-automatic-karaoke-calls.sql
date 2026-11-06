-- Up
ALTER TABLE karaokeCallJobs ADD COLUMN purpose TEXT NOT NULL DEFAULT 'preview';
ALTER TABLE karaokeCallJobs ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
ALTER TABLE animationInterventions ADD COLUMN callJSON TEXT;
CREATE TABLE karaokeCallControls (
  roomId INTEGER PRIMARY KEY REFERENCES rooms(roomId),
  revision INTEGER NOT NULL DEFAULT 0,
  preparing INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 0,
  setupRequestId TEXT,
  setupAttempt INTEGER NOT NULL DEFAULT 0,
  introIdsJSON TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE karaokeCallRequests (
  queueId INTEGER PRIMARY KEY REFERENCES queue(queueId) ON DELETE CASCADE,
  roomId INTEGER NOT NULL REFERENCES rooms(roomId),
  inputKey TEXT NOT NULL,
  introId TEXT,
  jobId TEXT REFERENCES karaokeCallJobs(id),
  resultId TEXT REFERENCES karaokeCallParts(id),
  status TEXT NOT NULL DEFAULT 'waiting',
  reason TEXT,
  attempt INTEGER NOT NULL DEFAULT 0,
  startedAt INTEGER,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX karaokeCallRequests_room ON karaokeCallRequests(roomId,status);
CREATE TABLE karaokeCallFallbacks (
  roomId INTEGER NOT NULL REFERENCES rooms(roomId),
  scope TEXT NOT NULL,
  inputKey TEXT NOT NULL,
  jobId TEXT REFERENCES karaokeCallJobs(id),
  resultId TEXT REFERENCES karaokeCallParts(id),
  PRIMARY KEY(roomId,scope)
);
-- Down
DROP TABLE karaokeCallFallbacks;
DROP TABLE karaokeCallRequests;
DROP TABLE karaokeCallControls;
ALTER TABLE animationInterventions DROP COLUMN callJSON;
ALTER TABLE karaokeCallJobs DROP COLUMN priority;
ALTER TABLE karaokeCallJobs DROP COLUMN purpose;
