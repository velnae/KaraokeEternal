-- Up
-- Rebuild referenced tables
CREATE TABLE birthdayAssetsWithApplause (
  id TEXT PRIMARY KEY,
  roomId INTEGER NOT NULL REFERENCES rooms(roomId) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('intro','greeting','music','video','bed','applause')),
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  durationMs INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  script TEXT
);
INSERT INTO birthdayAssetsWithApplause SELECT * FROM birthdayAssets;
DROP TABLE birthdayAssets;
ALTER TABLE birthdayAssetsWithApplause RENAME TO birthdayAssets;
-- Down
-- Rebuild referenced tables
CREATE TABLE birthdayAssetsWithoutApplause (
  id TEXT PRIMARY KEY,
  roomId INTEGER NOT NULL REFERENCES rooms(roomId) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('intro','greeting','music','video','bed')),
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  durationMs INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  script TEXT
);
INSERT INTO birthdayAssetsWithoutApplause SELECT id,roomId,CASE WHEN kind='applause' THEN 'music' ELSE kind END,title,filename,durationMs,checksum,script FROM birthdayAssets;
DROP TABLE birthdayAssets;
ALTER TABLE birthdayAssetsWithoutApplause RENAME TO birthdayAssets;
