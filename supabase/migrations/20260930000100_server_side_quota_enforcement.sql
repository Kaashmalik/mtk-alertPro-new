-- Server-side entitlement enforcement.
--
-- Why this migration exists:
--
-- Every quota in the app (camera count, automation count) was enforced *only*
-- in the client, inside addCamera() and the automation store. RLS checks
-- "is this your row", never "are you within your plan", so any authenticated
-- client could call PostgREST directly and insert a 3rd camera on the free
-- tier, or 50 automations on any tier. Client checks are UX; these triggers
-- are the actual boundary.
--
-- The values mirror PlanLimits in apps/mobile/src/lib/subscription/planLimits.ts
--   cameras:     free 2      pro Infinity  business Infinity
--   automations: free 3      pro 50        business Infinity
-- Postgres has no Infinity for an int, so "unlimited" is expressed as a very
-- large ceiling. Kept as literals (not a lookup table) so a mismatch is a
-- visible diff rather than a silent behaviour change; the two files are
-- covered by the planLimits tests on the client side.
--
-- The database is deliberately never stricter than the client: if this table
-- were tighter than PLAN_LIMITS, a user would be blocked from something the app
-- had already promised them.
--
-- Entitlement is read from profiles.subscription_tier and
-- subscription_expires_at with the same fail-closed rule as the client
-- (isTierActive): a paid tier with no expiry is treated as free, matching the
-- profiles_paid_requires_expiry constraint added in
-- 20260929000100_paid_tier_requires_expiry.sql.

-- ---------------------------------------------------------------------------
-- 1. Shared entitlement resolver
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.effective_tier(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p.subscription_tier IN ('pro', 'business')
      AND p.subscription_expires_at IS NOT NULL
      AND p.subscription_expires_at > NOW()
      THEN p.subscription_tier
    ELSE 'free'
  END
  FROM public.profiles p
  WHERE p.id = p_user_id;
$$;

-- ---------------------------------------------------------------------------
-- 2. Camera quota
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_camera_quota()
RETURNS TRIGGER AS $BODY$
DECLARE
  v_limit int;
  v_count int;
  v_tier text;
BEGIN
  -- Only NEW rows are checked; updates never change ownership or count.
  v_tier := public.effective_tier(NEW.user_id);
  v_limit := CASE v_tier
    WHEN 'business' THEN 2147483647   -- client: Infinity
    WHEN 'pro'      THEN 2147483647   -- client: Infinity
    ELSE 2                           -- client: PLAN_LIMITS.free.maxCameras
  END;

  SELECT count(*) INTO v_count
  FROM public.cameras c
  WHERE c.user_id = NEW.user_id;

  IF v_count >= v_limit THEN
    RAISE EXCEPTION
      'Camera limit reached for the % plan (%). Upgrade to add more cameras.', v_tier, v_limit
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$BODY$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_camera_quota ON public.cameras;
CREATE TRIGGER trg_enforce_camera_quota
  BEFORE INSERT ON public.cameras
  FOR EACH ROW EXECUTE FUNCTION public.enforce_camera_quota();

-- ---------------------------------------------------------------------------
-- 3. Automation quota
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_automation_quota()
RETURNS TRIGGER AS $BODY$
DECLARE
  v_limit int;
  v_count int;
  v_tier text;
BEGIN
  v_tier := public.effective_tier(NEW.user_id);
  v_limit := CASE v_tier
    WHEN 'business' THEN 2147483647   -- client: MAX_AUTOMATIONS.business = Infinity
    WHEN 'pro'      THEN 50          -- client: MAX_AUTOMATIONS.pro
    ELSE 3                           -- client: MAX_AUTOMATIONS.free
  END;

  SELECT count(*) INTO v_count
  FROM public.camera_automations a
  WHERE a.user_id = NEW.user_id;

  IF v_count >= v_limit THEN
    RAISE EXCEPTION
      'Automation limit reached for the % plan (%). Upgrade for more automations.', v_tier, v_limit
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$BODY$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_automation_quota ON public.camera_automations;
CREATE TRIGGER trg_enforce_automation_quota
  BEFORE INSERT ON public.camera_automations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_automation_quota();

-- ---------------------------------------------------------------------------
-- 4. Premium-only action on automations (Red Alert)
-- ---------------------------------------------------------------------------
-- Red Alert is a Pro feature (hasRedAlertMode). The client gates it, but an
-- automation row with action='red_alert' created directly would arm Red Alert
-- for a free account on every schedule. Require the plan for that action.
CREATE OR REPLACE FUNCTION public.enforce_automation_action()
RETURNS TRIGGER AS $BODY$
DECLARE
  v_tier text;
BEGIN
  IF NEW.action <> 'red_alert' THEN
    RETURN NEW;
  END IF;

  v_tier := public.effective_tier(NEW.user_id);
  IF v_tier = 'free' THEN
    RAISE EXCEPTION
      'Red Alert automations require an active Pro or Business plan.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$BODY$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_automation_action ON public.camera_automations;
CREATE TRIGGER trg_enforce_automation_action
  BEFORE INSERT OR UPDATE OF action ON public.camera_automations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_automation_action();

COMMENT ON FUNCTION public.effective_tier(uuid) IS
  'Expiry-aware, fail-closed tier resolution shared by the quota triggers. Mirrors isTierActive() in the client so a row can never be graded differently by the two.';
