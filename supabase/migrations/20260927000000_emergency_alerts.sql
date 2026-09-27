-- Emergency (SOS) persistence.
--
-- Two gaps this closes:
--  1. triggerEmergency() only played local audio + a local notification, so an
--     SOS left no server-side trace. Nothing was written to `alerts`.
--  2. `alerts.camera_id` is NOT NULL, so an SOS with no camera (the common
--     case: the button on the dashboard) could never be persisted at all.
--
-- Fixes: make camera_id nullable, allow the 'emergency' type, and add a
-- trusted-contacts table so the SOS can reach other people.

-- 1. SOS events are not always camera-scoped.
ALTER TABLE alerts
  ALTER COLUMN camera_id DROP NOT NULL;

-- 2. SOS is a first-class alert type.
ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_type_check;

ALTER TABLE alerts
  ADD CONSTRAINT alerts_type_check
  CHECK (type IN ('person', 'vehicle', 'face', 'motion', 'animal', 'emergency'));

COMMENT ON CONSTRAINT alerts_type_check ON alerts IS
  'Alert types including animal (scene opt-in) and emergency (SOS)';

-- SOS rows carry trigger context that detection rows do not.
ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS emergency_reason TEXT,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

COMMENT ON COLUMN alerts.camera_id IS
  'NULL for account-level events such as SOS triggers';

-- 3. Trusted contacts to notify when the user raises an SOS.
CREATE TABLE IF NOT EXISTS public.emergency_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  -- Optional: send even when the user resolves the SOS quickly.
  always_notify BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_emergency_contacts_user_id
  ON public.emergency_contacts(user_id);

ALTER TABLE public.emergency_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own emergency contacts" ON public.emergency_contacts;

CREATE POLICY "Users can manage their own emergency contacts"
  ON public.emergency_contacts
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
