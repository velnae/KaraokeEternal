-- Up
CREATE TABLE roomTables (
  tableId INTEGER PRIMARY KEY AUTOINCREMENT,
  roomId INTEGER NOT NULL REFERENCES rooms(roomId) ON DELETE CASCADE,
  code TEXT NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled', 'archived')),
  joinToken TEXT NOT NULL UNIQUE,
  dateCreated INTEGER NOT NULL,
  dateUpdated INTEGER NOT NULL,
  UNIQUE(roomId, code),
  UNIQUE(tableId, roomId)
);

-- Down
DROP TABLE roomTables;
