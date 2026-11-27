-- Up
ALTER TABLE users ADD COLUMN avatarId TEXT;

-- Down
ALTER TABLE users DROP COLUMN avatarId;
