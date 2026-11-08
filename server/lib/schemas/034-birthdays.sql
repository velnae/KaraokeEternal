-- Up
CREATE TABLE birthdaySettings (
  roomId INTEGER PRIMARY KEY REFERENCES rooms(roomId) ON DELETE CASCADE,
  data TEXT NOT NULL
);
CREATE TABLE birthdayAssets (
  id TEXT PRIMARY KEY,
  roomId INTEGER NOT NULL REFERENCES rooms(roomId) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('intro','greeting','music','video')),
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  durationMs INTEGER NOT NULL,
  checksum TEXT NOT NULL
);
CREATE TABLE birthdays (
  id TEXT PRIMARY KEY,
  roomId INTEGER NOT NULL REFERENCES rooms(roomId) ON DELETE CASCADE,
  requestId TEXT NOT NULL,
  name TEXT NOT NULL,
  sex TEXT NOT NULL,
  birthYear INTEGER NOT NULL,
  celebrationYear INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  generationRevision INTEGER NOT NULL DEFAULT 0,
  preparation TEXT NOT NULL DEFAULT 'queued',
  playback TEXT NOT NULL DEFAULT 'held',
  phase TEXT,
  script TEXT,
  voiceId TEXT NOT NULL,
  settingsJSON TEXT NOT NULL,
  greetingId TEXT,
  durationMs INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  createdAt INTEGER NOT NULL,
  startedAt INTEGER,
  phaseStartedAt INTEGER,
  ownerSocketId TEXT,
  token TEXT,
  leaseUntil INTEGER,
  UNIQUE(roomId, requestId)
);
CREATE UNIQUE INDEX birthdayNextSlot ON birthdays(roomId) WHERE playback IN ('scheduled','playing');
CREATE INDEX birthdayRoom ON birthdays(roomId, createdAt);
-- Down
DROP TABLE birthdays;
DROP TABLE birthdayAssets;
DROP TABLE birthdaySettings;
