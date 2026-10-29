-- Up
ALTER TABLE audioResources ADD COLUMN deletedAt INTEGER;
-- Down
ALTER TABLE audioResources DROP COLUMN deletedAt;
