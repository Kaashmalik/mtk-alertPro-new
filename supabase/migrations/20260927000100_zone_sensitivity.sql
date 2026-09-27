-- Per-zone detection sensitivity.
--
-- detection_zones existed in the schema but had no editor in the app, so a
-- "zone" could never be created or tuned. Sensitivity lets a user raise the
-- confidence bar for a noisy area (a street) while keeping it low for a
-- driveway, instead of using one global threshold for the whole frame.

ALTER TABLE detection_zones
  ADD COLUMN IF NOT EXISTS sensitivity FLOAT NOT NULL DEFAULT 0.6;

COMMENT ON COLUMN detection_zones.sensitivity IS
  'Minimum detection confidence required inside this zone (0-1)';

-- Clamp anything out of range so a bad write cannot silently disable a zone.
ALTER TABLE detection_zones
  DROP CONSTRAINT IF EXISTS detection_zones_sensitivity_range;

ALTER TABLE detection_zones
  ADD CONSTRAINT detection_zones_sensitivity_range
  CHECK (sensitivity >= 0 AND sensitivity <= 1);
