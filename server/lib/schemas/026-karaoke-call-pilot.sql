-- Up
CREATE TABLE karaokeCallParts (
  id TEXT PRIMARY KEY,
  roomId INTEGER NOT NULL REFERENCES rooms(roomId),
  kind TEXT NOT NULL,
  variantId TEXT NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  profileKey TEXT NOT NULL,
  cacheKey TEXT NOT NULL,
  master TEXT NOT NULL,
  filename TEXT NOT NULL,
  checksum TEXT NOT NULL,
  masterChecksum TEXT NOT NULL,
  durationMs INTEGER NOT NULL,
  dependenciesJSON TEXT NOT NULL DEFAULT '[]',
  retired INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL
);
CREATE INDEX karaokeCallParts_cache ON karaokeCallParts(roomId,cacheKey,retired);
CREATE TABLE tableCallVoices (
  tableId INTEGER PRIMARY KEY REFERENCES roomTables(tableId),
  roomId INTEGER NOT NULL REFERENCES rooms(roomId),
  spokenText TEXT NOT NULL,
  codeSnapshot TEXT NOT NULL,
  revision INTEGER NOT NULL,
  partId TEXT REFERENCES karaokeCallParts(id)
);
CREATE TABLE karaokeCallJobs (
  id TEXT PRIMARY KEY,
  roomId INTEGER NOT NULL REFERENCES rooms(roomId),
  requestId TEXT NOT NULL,
  operation TEXT NOT NULL,
  requestJSON TEXT NOT NULL,
  inputJSON TEXT NOT NULL,
  profileJSON TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  resultId TEXT REFERENCES karaokeCallParts(id),
  providerMs INTEGER NOT NULL DEFAULT 0,
  preparationMs INTEGER NOT NULL DEFAULT 0,
  retryAt INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  UNIQUE(roomId,requestId)
);
-- Down
DROP TABLE karaokeCallJobs;
DROP TABLE tableCallVoices;
DROP TABLE karaokeCallParts;
