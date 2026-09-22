-- ============================================================================
-- Camera Automations Schema
-- Enables scheduled automation of camera settings (Red Alert mode, etc.)
-- ============================================================================

-- Create camera_automations table
CREATE TABLE IF NOT EXISTS public.camera_automations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  camera_id UUID NOT NULL REFERENCES public.cameras(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  start_time TEXT NOT NULL CHECK (start_time ~ '^([0-1][0-9]|2[0-3]):[0-5][0-9]$'),
  end_time TEXT NOT NULL CHECK (end_time ~ '^([0-1][0-9]|2[0-3]):[0-5][0-9]$'),
  recurring TEXT NOT NULL CHECK (recurring IN ('daily', 'weekdays', 'weekends', 'custom')),
  days_of_week INTEGER[] CHECK (array_length(days_of_week, 1) IS NULL OR days_of_week <@ ARRAY[0,1,2,3,4,5,6]::INTEGER[]),
  action TEXT NOT NULL DEFAULT 'red_alert' CHECK (action IN ('red_alert', 'normal')),
  is_currently_active BOOLEAN DEFAULT false,
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_camera_automations_camera_id ON public.camera_automations(camera_id);
CREATE INDEX IF NOT EXISTS idx_camera_automations_user_id ON public.camera_automations(user_id);
CREATE INDEX IF NOT EXISTS idx_camera_automations_enabled ON public.camera_automations(enabled);
CREATE INDEX IF NOT EXISTS idx_camera_automations_created_at ON public.camera_automations(created_at DESC);

-- Enable RLS
ALTER TABLE public.camera_automations ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own camera automations"
  ON public.camera_automations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own camera automations"
  ON public.camera_automations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own camera automations"
  ON public.camera_automations FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own camera automations"
  ON public.camera_automations FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_camera_automations_updated_at
  BEFORE UPDATE ON public.camera_automations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Function to check and update automation status
CREATE OR REPLACE FUNCTION check_automation_status()
RETURNS TRIGGER AS $$
BEGIN
  -- This function can be called periodically to update is_currently_active
  -- based on the current time and schedule
  NEW.is_currently_active = (
    SELECT CASE
      WHEN recurring = 'daily' THEN true
      WHEN recurring = 'weekdays' AND EXTRACT(DOW FROM NOW()) BETWEEN 1 AND 5 THEN true
      WHEN recurring = 'weekends' AND EXTRACT(DOW FROM NOW()) IN (0, 6) THEN true
      WHEN recurring = 'custom' AND EXTRACT(DOW FROM NOW()) = ANY(days_of_week) THEN true
      ELSE false
    END
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Comment for documentation
COMMENT ON TABLE public.camera_automations IS 'Stores scheduled automation rules for camera settings';
COMMENT ON COLUMN public.camera_automations.start_time IS 'Start time in HH:mm format (24-hour)';
COMMENT ON COLUMN public.camera_automations.end_time IS 'End time in HH:mm format (24-hour)';
COMMENT ON COLUMN public.camera_automations.recurring IS 'Recurrence pattern: daily, weekdays, weekends, or custom';
COMMENT ON COLUMN public.camera_automations.days_of_week IS 'Days of week (0=Sunday, 6=Saturday) for custom recurrence';
COMMENT ON COLUMN public.camera_automations.action IS 'Action to perform when schedule is active';
