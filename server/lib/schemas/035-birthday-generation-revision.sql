-- Up
-- If column missing: birthdays.generationRevision
ALTER TABLE birthdays ADD COLUMN generationRevision INTEGER NOT NULL DEFAULT 0;
-- Down
