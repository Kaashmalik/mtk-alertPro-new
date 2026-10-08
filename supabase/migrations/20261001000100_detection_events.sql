-- detection_events: durable, aggregated-friendly event stream
--
-- Why this table exists:
--   `alerts` is a *curated notification* stream. It is deduplicated and then
--   trimmed to the plan retention window (7 days on Free, 30 on Pro). That makes
--   it the wrong place to answer questions like "how many people passed the
--   front door this week", "when is my driveway busiest", or "which zone has the
--   most false positives" -- the rows are already gone.
--
--   `detection_events` is the *raw* stream: one row per detection, never
--   deduplicated, retained independently of alert history. It is the substrate
--   for people counting, activity heatmaps, busiest-hour insights and
--   false-positive tuning, none of which are implementable on top of `alerts`.
--
-- Retention note: this is a high-volume table (roughly one row per detection
-- frame cluster, not per frame). It intentionally carries no plan-based
-- deletion trigger yet; a scheduled prune is the follow-up once real volume is
-- known. Bounding boxes are stored in the same normalized 0..1 coordinate space
-- used by the client so they can be rendered directly on the camera feed.
--
-- No BEGIN/COMMIT here: the Supabase migration runner already wraps each
-- migration in a transaction, and no other migration in this repo opens one.

CREATE TABLE IF NOT EXISTS public.detection_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  camera_id UUID NOT NULL REFERENCES public.cameras(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  zone_id UUID REFERENCES public.detection_zones(id) ON DELETE SET NULL,

  -- Kept in sync with alerts_type_check. 'package' is deliberately absent
  -- until a parcel-capable model exists: COCO has no parcel class, and mapping
  -- backpack/handbag to "package" would alert on people walking past.
  type TEXT NOT NULL
    CHECK (type IN ('person', 'vehicle', 'face', 'motion', 'animal', 'emergency')),

  -- 'detection'  = object seen
  -- 'zone_enter' = object crossed into a zone (line-crossing groundwork)
  -- 'zone_exit'  = object left a zone
  kind TEXT NOT NULL DEFAULT 'detection'
    CHECK (kind IN ('detection', 'zone_enter', 'zone_exit')),

  confidence DOUBLE PRECISION NOT NULL
    CHECK (confidence >= 0 AND confidence <= 1),

  -- Normalized 0..1 box: { x, y, width, height }
  bounding_box JSONB,

  -- Client-side detection metadata (scene profile, sensitivity, model version)
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,

  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Analytics access patterns: "my events over a time range", optionally per camera.
CREATE INDEX IF NOT EXISTS idx_detection_events_user_time
  ON public.detection_events (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_detection_events_camera_time
  ON public.detection_events (camera_id, occurred_at DESC);

-- People counting and busiest-zone grouping filter heavily on type.
CREATE INDEX IF NOT EXISTS idx_detection_events_user_type_time
  ON public.detection_events (user_id, type, occurred_at DESC);

COMMENT ON TABLE public.detection_events IS
  'Raw, non-deduplicated detection stream for analytics (people counting, '
  'heatmaps, insights). Distinct from alerts, which are deduplicated '
  'notifications trimmed to the plan alert-history window.';

COMMENT ON COLUMN public.detection_events.bounding_box IS
  'Normalized 0..1 { x, y, width, height } in camera-feed space.';

-- Row Level Security: a user may only ever read or write their own events.
ALTER TABLE public.detection_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own detection events"
  ON public.detection_events;
CREATE POLICY "Users can view own detection events"
  ON public.detection_events FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own detection events"
  ON public.detection_events;
CREATE POLICY "Users can insert own detection events"
  ON public.detection_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- No UPDATE/DELETE policies: events are immutable. A user who wants them gone
-- deletes the camera, which cascades.
