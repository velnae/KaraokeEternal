ALTER TABLE karaokeCallParts ADD COLUMN profileJSON TEXT;
ALTER TABLE karaokeCallControls ADD COLUMN setupPlanJSON TEXT;

-- Old reconciler receipts are not an authorization to rebuild a paid bank.
UPDATE karaokeCallJobs SET status='cancelled',error='La preparación automática de plantillas requiere una nueva solicitud manual.'
WHERE status='queued' AND purpose='setup' AND COALESCE(json_extract(inputJSON,'$.manualBank'),0)!=1 AND
  (operation IN ('intro','table') OR (operation='source' AND json_extract(inputJSON,'$.sourceKind') IN ('template','signature')));
