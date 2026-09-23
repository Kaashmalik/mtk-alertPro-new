-- Allow animal alert type for scene profiles (opt-in animal alerts)
-- Farm/shop presets suppress animals in app; type must be valid if ever persisted

ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_type_check;

ALTER TABLE alerts
  ADD CONSTRAINT alerts_type_check
  CHECK (type IN ('person', 'vehicle', 'face', 'motion', 'animal'));

COMMENT ON CONSTRAINT alerts_type_check ON alerts IS
  'Detection alert types including animal for scene-profile opt-in';
