-- Up
-- Old greetings are disposable. Keep consumed turns to avoid replaying transitions.
UPDATE greetingAudioJobs SET status='cancelled',cancelRequested=1,updatedAt=0,
  error='Saludo descartado al actualizar las reglas de publicación.';
UPDATE greetingTurns SET finished=1,voiceStatus='INTERRUPTED'
  WHERE turnKey IN (SELECT turnKey FROM greetings WHERE turnKey IS NOT NULL)
    AND finished=0;
DELETE FROM greetings;
ALTER TABLE greetings DROP COLUMN recipient;
-- Down
ALTER TABLE greetings ADD COLUMN recipient TEXT NOT NULL DEFAULT '';
