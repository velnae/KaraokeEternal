-- Up
CREATE TABLE musicPlaylists (
  playlistId INTEGER PRIMARY KEY AUTOINCREMENT,
  roomId INTEGER NOT NULL REFERENCES rooms(roomId) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80)
);
CREATE INDEX idxMusicPlaylistRoom ON musicPlaylists(roomId);
CREATE TABLE musicPlaylistItems (
  itemId INTEGER PRIMARY KEY AUTOINCREMENT,
  playlistId INTEGER NOT NULL REFERENCES musicPlaylists(playlistId) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('LOCAL','YOUTUBE')),
  sourceId TEXT NOT NULL,
  songJSON TEXT NOT NULL,
  UNIQUE(playlistId,source,sourceId)
);
CREATE TABLE housePlayback (
  roomId INTEGER PRIMARY KEY REFERENCES rooms(roomId) ON DELETE CASCADE,
  playlistId INTEGER REFERENCES musicPlaylists(playlistId) ON DELETE SET NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  repeat INTEGER NOT NULL DEFAULT 1 CHECK(repeat IN (0,1)),
  cursor INTEGER NOT NULL DEFAULT 0,
  runId TEXT NOT NULL,
  actorId INTEGER REFERENCES users(userId) ON DELETE SET NULL,
  message TEXT NOT NULL DEFAULT ''
);
-- Retain attribution even when the saved item is deleted.
ALTER TABLE queue ADD COLUMN playlistItemId INTEGER;
ALTER TABLE queue ADD COLUMN houseRunId TEXT;
CREATE INDEX idxQueueHouseRun ON queue(roomId,houseRunId,status);

-- Down
DROP INDEX idxQueueHouseRun;
ALTER TABLE queue DROP COLUMN houseRunId;
ALTER TABLE queue DROP COLUMN playlistItemId;
DROP TABLE housePlayback;
DROP TABLE musicPlaylistItems;
DROP TABLE musicPlaylists;
