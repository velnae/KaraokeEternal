-- Up
ALTER TABLE karaokeCallRequests ADD COLUMN playbackReason TEXT;
ALTER TABLE karaokeCallRequests ADD COLUMN recoveryJobId TEXT REFERENCES karaokeCallJobs(id);
ALTER TABLE karaokeCallRequests ADD COLUMN recoveredPartId TEXT REFERENCES karaokeCallParts(id);

-- Down
ALTER TABLE karaokeCallRequests DROP COLUMN recoveredPartId;
ALTER TABLE karaokeCallRequests DROP COLUMN recoveryJobId;
ALTER TABLE karaokeCallRequests DROP COLUMN playbackReason;
