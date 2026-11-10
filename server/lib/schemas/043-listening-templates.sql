-- Up
CREATE TABLE listeningTemplates (
  id TEXT PRIMARY KEY,
  roomId INTEGER NOT NULL REFERENCES rooms(roomId),
  text TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  partId TEXT REFERENCES karaokeCallParts(id),
  jobId TEXT REFERENCES karaokeCallJobs(id),
  createdAt INTEGER NOT NULL
);
CREATE INDEX listeningTemplates_room ON listeningTemplates(roomId,archived);
INSERT INTO listeningTemplates(id,roomId,text,createdAt)
SELECT 'listening-default-' || roomId || '-' || n,roomId,text,n FROM rooms CROSS JOIN (
  SELECT 1 n,'Este pedido llega de parte de…' text
  UNION ALL SELECT 2,'La siguiente canción la eligió…'
  UNION ALL SELECT 3,'Vamos con el pedido de…'
);
UPDATE listeningTemplates SET partId=(SELECT p.id FROM karaokeCallParts p
  WHERE p.roomId=listeningTemplates.roomId AND p.kind='template' AND p.text=listeningTemplates.text AND p.retired=0
  ORDER BY p.createdAt DESC LIMIT 1);
ALTER TABLE listeningPresentations ADD COLUMN templateId TEXT REFERENCES listeningTemplates(id);
ALTER TABLE listeningPresentations ADD COLUMN templatePartId TEXT REFERENCES karaokeCallParts(id);
UPDATE listeningPresentations SET
  templateId='listening-default-' || roomId || '-' || (((queueId-1) % 3)+1),
  templatePartId=(SELECT json_extract(p.dependenciesJSON,'$[0]') FROM karaokeCallParts p WHERE p.id=listeningPresentations.resultId);
-- Down
ALTER TABLE listeningPresentations DROP COLUMN templatePartId;
ALTER TABLE listeningPresentations DROP COLUMN templateId;
DROP TABLE listeningTemplates;
