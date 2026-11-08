-- Up
-- Keep an already configured display authoritative. Missing fields receive shared defaults on read.
INSERT OR IGNORE INTO prefs(key, data)
SELECT 'playerDisplay', json_object(
  'logo', json_object('enabled', json(CASE WHEN json_extract(data, '$.player.showLogo') = 1 THEN 'true' ELSE 'false' END)),
  'announcement', json_object(
    'enabled', json(CASE WHEN json_extract(data, '$.player.showAnnouncements') = 1 THEN 'true' ELSE 'false' END),
    'alignment', COALESCE(json_extract(data, '$.player.alignment'), 'left'),
    'backgroundColor', COALESCE(json_extract(data, '$.player.backgroundColor'), '#030509'),
    'messages', json(COALESCE(json_extract(data, '$.player.messages'), '[{"title":"Escanea el QR de tu mesa","text":"Pide tu música o anímate a cantar."}]'))
  )
)
FROM prefs WHERE key = 'branding' AND json_type(data, '$.player') = 'object';

UPDATE prefs SET data = json_remove(data, '$.player') WHERE key = 'branding';

-- Down
-- Restore legacy readers while retaining the new preference for a subsequent upgrade.
UPDATE prefs SET data = json_set(data, '$.player', json_object(
  'showLogo', json(CASE WHEN (SELECT json_extract(data, '$.logo.enabled') FROM prefs WHERE key = 'playerDisplay') = 1 THEN 'true' ELSE 'false' END),
  'showAnnouncements', json(CASE WHEN (SELECT json_extract(data, '$.announcement.enabled') FROM prefs WHERE key = 'playerDisplay') = 1 THEN 'true' ELSE 'false' END),
  'alignment', COALESCE((SELECT json_extract(data, '$.announcement.alignment') FROM prefs WHERE key = 'playerDisplay'), 'left'),
  'backgroundColor', COALESCE((SELECT json_extract(data, '$.announcement.backgroundColor') FROM prefs WHERE key = 'playerDisplay'), '#030509'),
  'messages', json(COALESCE((SELECT json_extract(data, '$.announcement.messages') FROM prefs WHERE key = 'playerDisplay'), '[{"title":"Escanea el QR de tu mesa","text":"Pide tu música o anímate a cantar."}]'))
)) WHERE key = 'branding' AND EXISTS (SELECT 1 FROM prefs WHERE key = 'playerDisplay');
