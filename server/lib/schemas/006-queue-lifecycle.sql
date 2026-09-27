-- Up
PRAGMA defer_foreign_keys = ON;

ALTER TABLE queue RENAME TO queue_legacy;

DROP INDEX IF EXISTS idxRoom;
DROP INDEX IF EXISTS idxPrevQueueId;

CREATE TABLE "queue" (
  "queueId" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "roomId" integer NOT NULL REFERENCES rooms(roomId) DEFERRABLE INITIALLY DEFERRED,
  "songId" integer,
  "userId" integer NOT NULL REFERENCES users(userId) DEFERRABLE INITIALLY DEFERRED,
  "prevQueueId" integer REFERENCES queue(queueId) DEFERRABLE INITIALLY DEFERRED,
  "origin" text NOT NULL DEFAULT 'PARTICIPANT'
    CHECK (origin IN ('PARTICIPANT', 'HOUSE', 'OPERATOR')),
  "source" text NOT NULL DEFAULT 'LOCAL'
    CHECK (source IN ('LOCAL', 'YOUTUBE')),
  "status" text NOT NULL DEFAULT 'APPROVED'
    CHECK (status IN ('PENDING_APPROVAL', 'APPROVED', 'PLAYING', 'PLAYED', 'REJECTED', 'REMOVED', 'FAILED')),
  "externalId" text,
  "title" text NOT NULL,
  "artistOrChannel" text NOT NULL,
  "durationSeconds" integer,
  "thumbnailUrl" text,
  "dateCreated" integer NOT NULL DEFAULT 0,
  "dateUpdated" integer NOT NULL DEFAULT 0,
  CHECK (
    (source = 'LOCAL' AND songId IS NOT NULL AND externalId IS NULL)
    OR (source = 'YOUTUBE' AND songId IS NULL AND externalId IS NOT NULL)
  )
);

CREATE INDEX idxRoom ON queue (roomId ASC);
CREATE INDEX idxPrevQueueId ON queue (prevQueueId ASC);
CREATE INDEX idxQueueRoomStatus ON queue (roomId ASC, status ASC);
CREATE INDEX idxQueueRoomUserStatus ON queue (roomId ASC, userId ASC, status ASC);

INSERT INTO queue (
  queueId,
  roomId,
  songId,
  userId,
  prevQueueId,
  origin,
  source,
  status,
  title,
  artistOrChannel,
  durationSeconds,
  dateCreated,
  dateUpdated
)
SELECT
  q.queueId,
  q.roomId,
  q.songId,
  q.userId,
  q.prevQueueId,
  'PARTICIPANT',
  'LOCAL',
  'APPROVED',
  COALESCE(songs.title, 'Unknown song'),
  COALESCE(artists.name, 'Unknown artist'),
  (
    SELECT media.duration
    FROM media
      INNER JOIN paths USING(pathId)
    WHERE media.songId = q.songId
    ORDER BY media.isPreferred DESC, paths.priority ASC, media.mediaId ASC
    LIMIT 1
  ),
  0,
  0
FROM queue_legacy q
  LEFT JOIN songs USING(songId)
  LEFT JOIN artists USING(artistId);

DROP TABLE queue_legacy;

-- Down
PRAGMA defer_foreign_keys = ON;

ALTER TABLE queue RENAME TO queue_lifecycle;

DROP INDEX IF EXISTS idxRoom;
DROP INDEX IF EXISTS idxPrevQueueId;
DROP INDEX IF EXISTS idxQueueRoomStatus;
DROP INDEX IF EXISTS idxQueueRoomUserStatus;

CREATE TABLE "queue" (
  "queueId" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "roomId" integer NOT NULL REFERENCES rooms(roomId) DEFERRABLE INITIALLY DEFERRED,
  "songId" integer NOT NULL,
  "userId" integer NOT NULL REFERENCES users(userId) DEFERRABLE INITIALLY DEFERRED,
  "prevQueueId" integer REFERENCES queue(queueId) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX idxRoom ON queue (roomId ASC);
CREATE INDEX idxPrevQueueId ON queue (prevQueueId ASC);

INSERT INTO queue (queueId, roomId, songId, userId, prevQueueId)
SELECT queueId, roomId, songId, userId, prevQueueId
FROM queue_lifecycle
WHERE source = 'LOCAL' AND songId IS NOT NULL AND status NOT IN ('REJECTED', 'REMOVED');

DROP TABLE queue_lifecycle;
