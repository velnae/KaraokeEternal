-- Up
ALTER TABLE transitionVideos ADD COLUMN active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1));
ALTER TABLE transitionVideos ADD COLUMN selectionOrder INTEGER NOT NULL DEFAULT 0;
UPDATE transitionVideos SET active=1 WHERE retiredAt IS NULL AND state='ready'
  AND id=(SELECT json_extract(data,'$.prefs.transitionVideo.videoId') FROM rooms WHERE roomId=transitionVideos.roomId);
-- Down
UPDATE rooms SET data=json_remove(data,'$.prefs.transitionVideo.mode');
ALTER TABLE transitionVideos DROP COLUMN selectionOrder;
ALTER TABLE transitionVideos DROP COLUMN active;
