CREATE TABLE karaokeBackgroundAssets_next (
  id TEXT PRIMARY KEY,
  roomId INTEGER NOT NULL REFERENCES rooms(roomId) ON DELETE CASCADE,
  requestId TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('video','bed','effect')),
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
INSERT INTO karaokeBackgroundAssets_next SELECT * FROM karaokeBackgroundAssets;
DROP TABLE karaokeBackgroundAssets;
ALTER TABLE karaokeBackgroundAssets_next RENAME TO karaokeBackgroundAssets;
ALTER TABLE karaokeStartTurns ADD COLUMN reminderAt INTEGER;
ALTER TABLE animationInterventions ADD COLUMN karaokeCueJSON TEXT;
