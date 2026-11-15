-- Up
CREATE TABLE birthdayAssetsWithBed (
  id TEXT PRIMARY KEY,
  roomId INTEGER NOT NULL REFERENCES rooms(roomId) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('intro','greeting','music','video','bed')),
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  durationMs INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  script TEXT
);
INSERT INTO birthdayAssetsWithBed SELECT id,roomId,kind,title,filename,durationMs,checksum,script FROM birthdayAssets;
DROP TABLE birthdayAssets;
ALTER TABLE birthdayAssetsWithBed RENAME TO birthdayAssets;
-- Down
CREATE TABLE birthdayAssetsWithoutBed (
  id TEXT PRIMARY KEY,
  roomId INTEGER NOT NULL REFERENCES rooms(roomId) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('intro','greeting','music','video')),
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  durationMs INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  script TEXT
);
INSERT INTO birthdayAssetsWithoutBed SELECT id,roomId,CASE WHEN kind='bed' THEN 'music' ELSE kind END,title,filename,durationMs,checksum,script FROM birthdayAssets;
DROP TABLE birthdayAssets;
ALTER TABLE birthdayAssetsWithoutBed RENAME TO birthdayAssets;
