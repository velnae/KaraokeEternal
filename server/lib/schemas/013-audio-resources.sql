-- Up
CREATE TABLE audioResources (
  id TEXT PRIMARY KEY,
  roomId INTEGER REFERENCES rooms(roomId) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('voice','effect','ambience')),
  title TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','disabled','archived')),
  preparation TEXT NOT NULL DEFAULT 'preparing',
  metadataJSON TEXT NOT NULL,
  filename TEXT,
  mime TEXT,
  checksum TEXT,
  durationMs INTEGER,
  size INTEGER,
  error TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX audio_resources_inventory ON audioResources(roomId,kind,state,createdAt);
UPDATE animationRoomState SET microphoneOccupied=0;
-- Down
DROP TABLE audioResources;
