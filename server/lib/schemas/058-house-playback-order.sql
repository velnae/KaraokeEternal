-- Up
ALTER TABLE housePlayback ADD COLUMN itemOrderJSON TEXT;

-- Down
ALTER TABLE housePlayback DROP COLUMN itemOrderJSON;
