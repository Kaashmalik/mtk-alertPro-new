-- ============================================================================
-- Function privilege + search_path hardening.
--
-- Closes the four `supabase db lint` security findings that were still open on
-- 2026-10-08, without changing any behaviour the app depends on.
--
--   lint 0011 function_search_path_mutable        -> 6 functions
--   lint 0028 anon_security_definer_function_executable
--                                                 -> effective_tier, handle_new_user
--   lint 0029 authenticated_security_definer_function_executable
--                                                 -> effective_tier (plus the
--                                                    by-design downgrade_subscription)
--
-- Two rules are applied:
--
--   1. Pin `search_path` to '' on every function and fully qualify every
--      reference. A SECURITY DEFINER function with a mutable search_path can be
--      redirected at a caller-controlled schema, which is the standard way to
--      turn "reads profiles" into "runs my code as the table owner".
--
--   2. A trigger function is never an API. Its whole job is to be invoked by
--      the trigger manager, which does not check EXECUTE, so nobody needs
--      permission to call it over PostgREST. Verified against this database
--      before the revokes were written: revoking EXECUTE from `authenticated`
--      and then inserting into `cameras` still fired trg_enforce_camera_quota.
--
-- effective_tier is the one non-trigger function in the set, and it *is* called
-- as a plain function -- but only from inside the three enforce_* triggers,
-- which are made SECURITY DEFINER here. That decouples the triggers from the
-- caller's role, so effective_tier can then be locked to service_role without
-- the quota checks losing their ability to read the tier.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. handle_new_user -- signup trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. update_updated_at -- shared BEFORE UPDATE trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. check_automation_status -- defined in 20250109000000 but never attached to
--    a trigger (is_currently_active is computed client-side). Kept for parity
--    with the original migration; nothing fires it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_automation_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
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
$$;

-- ---------------------------------------------------------------------------
-- 4. Quota triggers
--
-- SECURITY DEFINER so that step 5 can drop authenticated's EXECUTE on
-- effective_tier. This does not widen what they can see: they already resolve
-- the tier through effective_tier(), which is itself SECURITY DEFINER, and the
-- only rows they count are the NEW row's own user_id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_camera_quota()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $BODY$
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
$BODY$;

CREATE OR REPLACE FUNCTION public.enforce_automation_quota()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $BODY$
DECLARE
  v_limit int;
  v_count int;
  v_tier text;
BEGIN
  v_tier := public.effective_tier(NEW.user_id);
  v_limit := CASE v_tier
    WHEN 'business' THEN 2147483647   -- client: MAX_AUTOMATIONS.business = Infinity
    WHEN 'pro'      THEN 50            -- client: MAX_AUTOMATIONS.pro
    ELSE 3                             -- client: MAX_AUTOMATIONS.free
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
$BODY$;

CREATE OR REPLACE FUNCTION public.enforce_automation_action()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $BODY$
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
$BODY$;

-- ---------------------------------------------------------------------------
-- 5. Revokes
-- ---------------------------------------------------------------------------

-- Trigger functions: reachable only through their trigger.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_automation_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_camera_quota() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_automation_quota() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_automation_action() FROM PUBLIC, anon, authenticated;

-- effective_tier reads any profile's tier by id. The app never calls it, so
-- there is no client-side reason to keep it callable by anyone.
REVOKE ALL ON FUNCTION public.effective_tier(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.effective_tier(uuid) TO service_role;

COMMENT ON FUNCTION public.effective_tier(uuid) IS
  'Expiry-aware, fail-closed tier resolution used by the quota triggers. Mirrors isTierActive() in the client. Not an RPC: service_role only, so a signed-in user cannot probe another account''s plan.';

-- ---------------------------------------------------------------------------
-- 6. downgrade_subscription is the one authenticated SECURITY DEFINER that
--    lint 0029 will keep flagging. That is intended, and here is why:
--    it reads auth.uid() and writes only that row, so the blast radius of
--    calling it is "downgrade myself to Free".
-- ---------------------------------------------------------------------------
COMMENT ON FUNCTION public.downgrade_subscription() IS
  'Self-service cancellation. SECURITY DEFINER because profiles.subscription_tier is not client-writable, but it resolves its target from auth.uid() and never accepts a user id, so it can only ever downgrade the caller. The lint 0029 warning on this function is expected.';