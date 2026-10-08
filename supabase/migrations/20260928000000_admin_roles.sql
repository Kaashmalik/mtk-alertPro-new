-- ============================================================================
-- Admin roles & subscription controls
--
-- Adds a first-class admin role so a trusted operator can review manual
-- payment requests and manage subscriptions from the app, without handing out
-- the service_role key.
--
-- Security model:
--   * profiles.is_admin marks an admin. It can only be set by the service_role
--     (the hardening migration already revoked client UPDATE on this column,
--     and is_admin is intentionally NOT in the authenticated GRANT list), so a
--     user can never make themselves an admin.
--   * private.is_admin() is a SECURITY DEFINER helper that reads the flag while
--     bypassing RLS. This avoids infinite recursion when a policy on profiles
--     needs to ask "is the caller an admin?".
--   * All admin RPCs are SECURITY DEFINER and gate on private.is_admin() as
--     their first statement, so being granted EXECUTE is not enough to act.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Admin flag (service_role-only writable ??? not in the authenticated GRANT)
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 2. Admin-check helper (private schema, SECURITY DEFINER, no RLS recursion)
-- ---------------------------------------------------------------------------
-- The schema itself must be reachable by the roles that are allowed to call the
-- helper. A brand-new schema grants USAGE to its owner only, so without this
-- every policy and admin RPC below fails with "permission denied for schema
-- private" the moment it is reached from a client request.
CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT COALESCE(
    (SELECT p.is_admin FROM public.profiles p WHERE p.id = (SELECT auth.uid())),
    false
  );
$$;

REVOKE EXECUTE ON FUNCTION private.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_admin() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Admin read policies (additive ??? user-scoped policies still apply to users)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT
  USING ((select private.is_admin()));

DROP POLICY IF EXISTS "Admins can view all payment requests" ON public.payment_requests;
CREATE POLICY "Admins can view all payment requests"
  ON public.payment_requests FOR SELECT
  USING ((select private.is_admin()));

DROP POLICY IF EXISTS "Admins can view all payment history" ON public.payment_history;
CREATE POLICY "Admins can view all payment history"
  ON public.payment_history FOR SELECT
  USING ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- 4. Admin RPCs ??? all gate on private.is_admin() before doing anything
-- ---------------------------------------------------------------------------

-- Approve a pending manual payment (admin equivalent of service_role
-- confirm_payment). Reuses confirm_payment, which runs with owner privileges
-- inside this SECURITY DEFINER function.
CREATE OR REPLACE FUNCTION public.admin_confirm_payment(
  p_payment_request_id uuid,
  p_transaction_id text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (SELECT private.is_admin()) THEN
    RETURN json_build_object('success', false, 'error', 'not_authorized');
  END IF;

  RETURN public.confirm_payment(p_payment_request_id, p_transaction_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_confirm_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_confirm_payment(uuid, text) TO authenticated, service_role;

-- Reject a pending payment with a reason.
CREATE OR REPLACE FUNCTION public.admin_reject_payment(
  p_payment_request_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT (SELECT private.is_admin()) THEN
    RETURN json_build_object('success', false, 'error', 'not_authorized');
  END IF;

  SELECT status INTO v_status FROM payment_requests WHERE id = p_payment_request_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'not_found');
  END IF;
  IF v_status <> 'pending' THEN
    RETURN json_build_object('success', false, 'error', 'not_pending');
  END IF;

  UPDATE payment_requests
  SET status = 'rejected',
      notes = COALESCE(p_reason, notes),
      updated_at = now()
  WHERE id = p_payment_request_id;

  RETURN json_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_reject_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reject_payment(uuid, text) TO authenticated, service_role;

-- Manually grant or revoke a subscription tier (e.g. comped Pro, or a refund
-- downgrade). p_months is ignored for the 'free' tier, which clears expiry.
CREATE OR REPLACE FUNCTION public.admin_set_subscription(
  p_user_id uuid,
  p_tier text,
  p_months int DEFAULT 1
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expires timestamptz;
BEGIN
  IF NOT (SELECT private.is_admin()) THEN
    RETURN json_build_object('success', false, 'error', 'not_authorized');
  END IF;

  IF p_tier NOT IN ('free', 'pro', 'business') THEN
    RETURN json_build_object('success', false, 'error', 'invalid_tier');
  END IF;

  IF p_tier = 'free' THEN
    v_expires := NULL;
  ELSE
    v_expires := now() + (GREATEST(p_months, 1) || ' months')::interval;
  END IF;

  UPDATE profiles
  SET subscription_tier = p_tier,
      subscription_expires_at = v_expires,
      updated_at = now()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'user_not_found');
  END IF;

  RETURN json_build_object('success', true, 'tier', p_tier, 'expires_at', v_expires);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_set_subscription(uuid, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_subscription(uuid, text, int) TO authenticated, service_role;

-- Index to make the admin "pending payments" queue fast.
CREATE INDEX IF NOT EXISTS idx_payment_requests_status_created
  ON public.payment_requests(status, created_at DESC);
