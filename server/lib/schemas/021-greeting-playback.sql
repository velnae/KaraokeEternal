-- Up
ALTER TABLE queue ADD COLUMN requestIntent TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(requestIntent IN ('UNKNOWN','SING','LISTEN'));
ALTER TABLE greetingControls ADD COLUMN playbackJSON TEXT NOT NULL DEFAULT '{"enabled":false,"introClipId":null,"ambienceEnabled":true}';
ALTER TABLE greetingControls ADD COLUMN playbackVersion INTEGER NOT NULL DEFAULT 0;
ALTER TABLE greetingTurns ADD COLUMN interventionId TEXT REFERENCES animationInterventions(interventionId) ON DELETE SET NULL;
ALTER TABLE greetingTurns ADD COLUMN displayMs INTEGER;
ALTER TABLE greetingTurns ADD COLUMN playbackVersion INTEGER;
ALTER TABLE greetingTurns ADD COLUMN voiceStatus TEXT CHECK(voiceStatus IN ('SCREEN','SCHEDULED','PLAYING','PLAYED','FAILED','INTERRUPTED'));
ALTER TABLE greetingTurns ADD COLUMN voiceReason TEXT;
ALTER TABLE greetingTurns ADD COLUMN voiceStartedAt INTEGER;
ALTER TABLE greetingTurns ADD COLUMN voiceEndedAt INTEGER;
CREATE INDEX greeting_intervention ON greetingTurns(interventionId) WHERE interventionId IS NOT NULL;
ALTER TABLE animationInterventions ADD COLUMN voiceDurationMs INTEGER;
-- Down
ALTER TABLE animationInterventions DROP COLUMN voiceDurationMs;
DROP INDEX greeting_intervention;
ALTER TABLE greetingTurns DROP COLUMN voiceEndedAt;
ALTER TABLE greetingTurns DROP COLUMN voiceStartedAt;
ALTER TABLE greetingTurns DROP COLUMN voiceReason;
ALTER TABLE greetingTurns DROP COLUMN voiceStatus;
ALTER TABLE greetingTurns DROP COLUMN playbackVersion;
ALTER TABLE greetingTurns DROP COLUMN displayMs;
ALTER TABLE greetingTurns DROP COLUMN interventionId;
ALTER TABLE greetingControls DROP COLUMN playbackVersion;
ALTER TABLE greetingControls DROP COLUMN playbackJSON;
ALTER TABLE queue DROP COLUMN requestIntent;
