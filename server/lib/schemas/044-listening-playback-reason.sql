-- Up
ALTER TABLE listeningPresentations ADD COLUMN playbackReason TEXT;
ALTER TABLE listeningPresentations ADD COLUMN recoveryJobId TEXT REFERENCES karaokeCallJobs(id);

-- Down
ALTER TABLE listeningPresentations DROP COLUMN recoveryJobId;
ALTER TABLE listeningPresentations DROP COLUMN playbackReason;
