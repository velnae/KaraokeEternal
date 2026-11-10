-- Up
-- Rebuild referenced tables
CREATE TABLE namePronunciations (
  id TEXT PRIMARY KEY,
  spokenText TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE TABLE nameVoiceAliases (
  aliasKey TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  nameId TEXT NOT NULL REFERENCES namePronunciations(id)
);
CREATE INDEX name_voice_alias_group ON nameVoiceAliases(nameId);

CREATE TABLE karaokeCallParts_global (
  id TEXT PRIMARY KEY,
  roomId INTEGER REFERENCES rooms(roomId),
  kind TEXT NOT NULL,
  variantId TEXT NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  profileKey TEXT NOT NULL,
  cacheKey TEXT NOT NULL,
  master TEXT NOT NULL,
  filename TEXT NOT NULL,
  checksum TEXT NOT NULL,
  masterChecksum TEXT NOT NULL,
  durationMs INTEGER NOT NULL,
  dependenciesJSON TEXT NOT NULL DEFAULT '[]',
  retired INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  nameId TEXT REFERENCES namePronunciations(id),
  nameSelected INTEGER NOT NULL DEFAULT 0,
  nameMetadataJSON TEXT,
  CHECK(roomId IS NOT NULL OR kind='name'),
  CHECK(nameId IS NULL OR kind='name')
);
INSERT INTO karaokeCallParts_global(id,roomId,kind,variantId,title,text,profileKey,cacheKey,master,filename,checksum,masterChecksum,durationMs,dependenciesJSON,retired,createdAt)
  SELECT id,CASE WHEN kind='name' THEN NULL ELSE roomId END,kind,variantId,title,text,profileKey,cacheKey,master,filename,checksum,masterChecksum,durationMs,dependenciesJSON,retired,createdAt
  FROM karaokeCallParts;
DROP TABLE karaokeCallParts;
ALTER TABLE karaokeCallParts_global RENAME TO karaokeCallParts;
CREATE INDEX karaokeCallParts_cache ON karaokeCallParts(roomId,cacheKey,retired);
CREATE UNIQUE INDEX name_voice_selected ON karaokeCallParts(nameId,profileKey) WHERE nameSelected=1 AND nameId IS NOT NULL;
CREATE UNIQUE INDEX name_voice_request ON karaokeCallJobs(requestId)
  WHERE operation='source' AND json_extract(inputJSON,'$.sourceKind')='name' AND json_extract(inputJSON,'$.nameBankRevision')=1;

CREATE TABLE nameVoiceUses (
  executionId TEXT NOT NULL,
  assetId TEXT NOT NULL,
  partId TEXT NOT NULL REFERENCES karaokeCallParts(id),
  roomId INTEGER NOT NULL,
  completedAt INTEGER NOT NULL,
  PRIMARY KEY(executionId,assetId,partId)
);
CREATE INDEX name_voice_usage ON nameVoiceUses(partId,completedAt);

-- Down
-- Name audio ownership and paid resources are retained on binary rollback.
