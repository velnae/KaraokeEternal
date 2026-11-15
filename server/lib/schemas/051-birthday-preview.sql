-- Up
CREATE TABLE birthdayPreviewDrafts (
  userId INTEGER NOT NULL REFERENCES users(userId) ON DELETE CASCADE,
  roomId INTEGER NOT NULL REFERENCES rooms(roomId) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0,
  draftJSON TEXT NOT NULL,
  PRIMARY KEY (userId, roomId)
);
CREATE TABLE birthdayPreviewSamples (
  userId INTEGER NOT NULL REFERENCES users(userId) ON DELETE CASCADE,
  roomId INTEGER NOT NULL REFERENCES rooms(roomId) ON DELETE CASCADE,
  cacheKey TEXT NOT NULL,
  assetId TEXT NOT NULL REFERENCES birthdayAssets(id) ON DELETE CASCADE,
  updatedAt INTEGER NOT NULL,
  PRIMARY KEY (userId, roomId, cacheKey)
);

-- Down
DROP TABLE birthdayPreviewSamples;
DROP TABLE birthdayPreviewDrafts;
