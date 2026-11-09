-- Up
ALTER TABLE birthdays ADD COLUMN sceneJSON TEXT;
ALTER TABLE birthdayAssets ADD COLUMN script TEXT;
CREATE TABLE birthdayIntroUses (
  runId TEXT PRIMARY KEY,
  birthdayId TEXT NOT NULL REFERENCES birthdays(id) ON DELETE CASCADE,
  roomId INTEGER NOT NULL REFERENCES rooms(roomId) ON DELETE CASCADE,
  dayKey TEXT NOT NULL,
  introId TEXT NOT NULL,
  checksum TEXT NOT NULL,
  startedAt INTEGER NOT NULL
);
CREATE INDEX birthdayIntroRotation ON birthdayIntroUses(roomId,dayKey,startedAt);
-- Down
DROP TABLE birthdayIntroUses;
ALTER TABLE birthdayAssets DROP COLUMN script;
ALTER TABLE birthdays DROP COLUMN sceneJSON;
