-- Up
ALTER TABLE listeningPresentations ADD COLUMN namePartId TEXT REFERENCES karaokeCallParts(id);

-- Down
ALTER TABLE listeningPresentations DROP COLUMN namePartId;
