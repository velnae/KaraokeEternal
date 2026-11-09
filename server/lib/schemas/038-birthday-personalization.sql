-- Up
ALTER TABLE birthdays ADD COLUMN personalizationJSON TEXT;
-- Down
ALTER TABLE birthdays DROP COLUMN personalizationJSON;
