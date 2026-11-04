-- Up
CREATE TABLE transitionVideoLeases (
  leaseKey TEXT NOT NULL,
  videoId TEXT NOT NULL REFERENCES transitionVideos(id) ON DELETE CASCADE,
  roomId INTEGER NOT NULL REFERENCES rooms(roomId) ON DELETE CASCADE,
  untilAt INTEGER NOT NULL,
  backgroundJSON TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  PRIMARY KEY (leaseKey, videoId)
);
CREATE INDEX transition_video_lease_expiry ON transitionVideoLeases(untilAt);
CREATE INDEX transition_video_lease_asset ON transitionVideoLeases(videoId, untilAt);
-- Down
DROP TABLE transitionVideoLeases;
