-- Up
CREATE TABLE birthdayReviews (
  birthdayId TEXT NOT NULL REFERENCES birthdays(id) ON DELETE CASCADE,
  generationRevision INTEGER NOT NULL,
  greetingId TEXT,
  rating TEXT NOT NULL CHECK(rating IN ('unreviewed','good','improve')),
  note TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  updatedBy INTEGER NOT NULL,
  author TEXT NOT NULL,
  PRIMARY KEY(birthdayId, generationRevision)
);
CREATE INDEX birthdayHistoryOrder ON birthdays(roomId,createdAt DESC,id DESC);
-- Down
DROP INDEX birthdayHistoryOrder;
DROP TABLE birthdayReviews;
