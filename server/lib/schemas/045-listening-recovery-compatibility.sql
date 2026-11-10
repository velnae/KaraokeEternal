-- Up
-- If column missing: listeningPresentations.recoveryJobId
ALTER TABLE listeningPresentations ADD COLUMN recoveryJobId TEXT REFERENCES karaokeCallJobs(id);

-- Down
-- Compatibility repair: preserve the column and existing recovery receipts.
