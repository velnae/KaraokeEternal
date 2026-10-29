-- Up
CREATE TABLE audioRoomDeletions (
  roomId INTEGER NOT NULL REFERENCES rooms(roomId) ON DELETE CASCADE,
  resourceId TEXT NOT NULL REFERENCES audioResources(id) ON DELETE CASCADE,
  deletedAt INTEGER NOT NULL,
  PRIMARY KEY (roomId, resourceId)
);
-- Down
DROP TABLE audioRoomDeletions;
