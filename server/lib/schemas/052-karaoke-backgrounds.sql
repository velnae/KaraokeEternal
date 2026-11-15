CREATE TABLE karaokeBackgroundAssets (
  id TEXT PRIMARY KEY,
  roomId INTEGER NOT NULL REFERENCES rooms(roomId) ON DELETE CASCADE,
  requestId TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('video','bed')),
  title TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'preparing',
  error TEXT,
  filename TEXT,
  checksum TEXT,
  durationMs INTEGER,
  width INTEGER,
  height INTEGER,
  size INTEGER,
  selectionOrder INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  UNIQUE(roomId,requestId)
);
CREATE TABLE karaokeBackgroundSettings (
  roomId INTEGER PRIMARY KEY REFERENCES rooms(roomId) ON DELETE CASCADE,
  data TEXT NOT NULL
);
CREATE TABLE karaokeBackgroundScenes (
  roomId INTEGER PRIMARY KEY REFERENCES rooms(roomId) ON DELETE CASCADE,
  sceneId TEXT NOT NULL,
  queueId INTEGER NOT NULL,
  mediaJSON TEXT NOT NULL,
  untilAt INTEGER NOT NULL
);
