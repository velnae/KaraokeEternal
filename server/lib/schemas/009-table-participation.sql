-- Up
CREATE TABLE participantSessions (
  participantSessionId TEXT PRIMARY KEY,
  userId INTEGER NOT NULL REFERENCES users(userId) ON DELETE CASCADE,
  roomId INTEGER NOT NULL REFERENCES rooms(roomId) ON DELETE CASCADE,
  tableId INTEGER NOT NULL,
  dateCreated INTEGER NOT NULL,
  expiresAt INTEGER NOT NULL,
  revokedAt INTEGER,
  FOREIGN KEY(tableId, roomId) REFERENCES roomTables(tableId, roomId) ON DELETE CASCADE
);
CREATE INDEX participantSessions_table ON participantSessions(tableId, revokedAt, expiresAt);
ALTER TABLE queue ADD COLUMN tableId INTEGER REFERENCES roomTables(tableId) ON DELETE SET NULL;
ALTER TABLE queue ADD COLUMN participantSessionId TEXT REFERENCES participantSessions(participantSessionId) ON DELETE SET NULL;
ALTER TABLE queue ADD COLUMN tableLabelSnapshot TEXT;

-- Down
ALTER TABLE queue DROP COLUMN tableLabelSnapshot;
ALTER TABLE queue DROP COLUMN participantSessionId;
ALTER TABLE queue DROP COLUMN tableId;
DROP TABLE participantSessions;
