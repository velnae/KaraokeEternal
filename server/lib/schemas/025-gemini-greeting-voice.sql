-- Up
-- Local profiles cannot be reused by the cloud provider. Keep greeting history.
UPDATE greetings SET audioJobId=NULL,audioReason=NULL
  WHERE audioJobId IN (SELECT jobId FROM greetingAudioJobs WHERE json_extract(profileJSON,'$.provider') IS NULL);
UPDATE greetingAudioJobs SET status='cancelled',cancelRequested=1,updatedAt=0
  WHERE json_extract(profileJSON,'$.provider') IS NULL;
DELETE FROM prefs WHERE key='localTts';
DROP INDEX greeting_audio_single_worker;
CREATE UNIQUE INDEX greeting_audio_single_worker ON greetingAudioJobs((1))
  WHERE status IN ('generating','preparing');
CREATE TABLE greetingVoiceRequests (
  requestId TEXT PRIMARY KEY,
  requestedAt INTEGER NOT NULL,
  day TEXT NOT NULL
);
CREATE INDEX greeting_voice_request_time ON greetingVoiceRequests(requestedAt);
CREATE INDEX greeting_voice_request_day ON greetingVoiceRequests(day);
CREATE TABLE greetingVoiceState (
  id INTEGER PRIMARY KEY CHECK(id=1),
  blockedUntil INTEGER NOT NULL DEFAULT 0,
  code TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT ''
);
INSERT INTO greetingVoiceState(id) VALUES(1);
-- Down
-- Resolve terminal cloud outcomes before restoring the old single-worker index.
UPDATE greetingAudioJobs SET status='failed' WHERE status='uncertain';
DROP INDEX greeting_audio_single_worker;
CREATE UNIQUE INDEX greeting_audio_single_worker ON greetingAudioJobs((1))
  WHERE status IN ('generating','preparing','uncertain');
DROP TABLE greetingVoiceRequests;
DROP TABLE greetingVoiceState;
DELETE FROM prefs WHERE key='greetingVoice';
