ALTER TABLE queue ADD COLUMN rejectionReason TEXT;
INSERT OR IGNORE INTO prefs(key,data) VALUES('musicBlocking','{"rules":[{"kind":"artist","artist":"Faraón Love Shady","aliases":["Faraón"]}]}');
