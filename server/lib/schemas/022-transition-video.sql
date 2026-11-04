-- Up
CREATE TABLE transitionVideos (
  id TEXT PRIMARY KEY NOT NULL,
  roomId INTEGER NOT NULL REFERENCES rooms(roomId) ON DELETE CASCADE,
  requestId TEXT NOT NULL,
  title TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'preparing' CHECK(state IN ('preparing','ready','failed')),
  reason TEXT,
  filename TEXT,
  posterFilename TEXT,
  durationMs INTEGER CHECK(durationMs > 0 AND durationMs <= 30000),
  width INTEGER CHECK(width > 0 AND width <= 1920),
  height INTEGER CHECK(height > 0 AND height <= 1080),
  frameRate REAL CHECK(frameRate > 0 AND frameRate <= 30),
  size INTEGER CHECK(size > 0 AND size <= 41943040),
  checksum TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  UNIQUE(roomId, requestId),
  CHECK(state != 'ready' OR (filename IS NOT NULL AND posterFilename IS NOT NULL
    AND durationMs IS NOT NULL AND width IS NOT NULL AND height IS NOT NULL
    AND frameRate IS NOT NULL AND size IS NOT NULL AND checksum IS NOT NULL AND reason IS NULL)),
  CHECK(state != 'failed' OR reason IS NOT NULL)
);
CREATE INDEX transition_videos_room_created ON transitionVideos(roomId, createdAt DESC);
-- Down
UPDATE rooms SET data = json_remove(data, '$.prefs.transitionVideo');
DROP TABLE transitionVideos;
