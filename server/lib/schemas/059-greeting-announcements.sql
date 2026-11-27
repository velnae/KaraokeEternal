-- Up
ALTER TABLE greetings ADD COLUMN announcementWithdrawnAt INTEGER;

-- Down
ALTER TABLE greetings DROP COLUMN announcementWithdrawnAt;
