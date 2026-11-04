-- Up
-- Keep request receipts after retiring binary assets so retries never resurrect them.
ALTER TABLE transitionVideos ADD COLUMN retiredAt INTEGER;
-- Down
ALTER TABLE transitionVideos DROP COLUMN retiredAt;
