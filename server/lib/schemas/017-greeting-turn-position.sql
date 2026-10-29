-- Up
-- If column missing: greetingTurnItems.position
-- Early installations applied migration 016 before sequence position was added.
ALTER TABLE greetingTurnItems ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
UPDATE greetingTurnItems AS current
SET position = (
  SELECT COUNT(*) FROM greetingTurnItems AS earlier
  WHERE earlier.turnKey = current.turnKey AND earlier.queueId < current.queueId
);

-- Down
-- Keep this additive compatibility column: later revisions of 016 already own it.
SELECT 1;
