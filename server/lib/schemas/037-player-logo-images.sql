-- Up
CREATE TABLE playerLogoImages (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('png','gif')),
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  frames INTEGER NOT NULL,
  durationMs INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

-- Down
DROP TABLE playerLogoImages;
