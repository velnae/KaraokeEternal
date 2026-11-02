-- Up
CREATE TABLE greetingAudioJobs (
  jobId TEXT PRIMARY KEY,
  -- Keep an in-flight recovery barrier even when its room is deleted.
  roomId INTEGER REFERENCES rooms(roomId) ON DELETE SET NULL,
  cacheKey TEXT NOT NULL,
  spokenText TEXT NOT NULL,
  profileJSON TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','generating','preparing','ready','uncertain','failed','cancelled')),
  cancelRequested INTEGER NOT NULL DEFAULT 0 CHECK(cancelRequested IN (0,1)),
  attempts INTEGER NOT NULL DEFAULT 0,
  attemptId TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  retryAt INTEGER NOT NULL DEFAULT 0,
  filename TEXT,
  checksum TEXT,
  durationMs INTEGER,
  error TEXT
);
CREATE UNIQUE INDEX greeting_audio_cache ON greetingAudioJobs(roomId,cacheKey)
  WHERE status IN ('queued','generating','preparing','ready','uncertain') AND cancelRequested=0;
CREATE UNIQUE INDEX greeting_audio_single_worker ON greetingAudioJobs((1))
  WHERE status IN ('generating','preparing','uncertain');
ALTER TABLE greetings ADD COLUMN audioJobId TEXT REFERENCES greetingAudioJobs(jobId) ON DELETE SET NULL;
ALTER TABLE greetings ADD COLUMN audioReason TEXT;
CREATE INDEX greetings_audio_job ON greetings(audioJobId);
ALTER TABLE greetingControls ADD COLUMN audioEnabled INTEGER NOT NULL DEFAULT 0 CHECK(audioEnabled IN (0,1));
-- Down
DROP INDEX greetings_audio_job;
ALTER TABLE greetings DROP COLUMN audioJobId;
ALTER TABLE greetings DROP COLUMN audioReason;
ALTER TABLE greetingControls DROP COLUMN audioEnabled;
DROP TABLE greetingAudioJobs;
