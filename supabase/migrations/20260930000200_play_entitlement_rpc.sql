-- Play / RevenueCat entitlement RPC.
--
-- Why this is separate from confirm_payment():
--   confirm_payment() is the *manual* payment flow. It looks the user up in
--   payment_requests and hardcodes `+ interval '1 month'`, which is wrong for
--   Play: an annual purchase must extend the expiry by a year, and a renewal must
--   not stack on top of a previous extension. Play also has no payment_requests
--   row, so confirm_payment() can never apply a Play purchase at all.
--
-- This RPC is the server-side authority for Play. It:
--   * verifies the plan against the profiles CHECK constraint,
--   * sets the expiry from the store's own expiration_at (never computed here),
--   * records the subscription row for audit / restore,
--   * is callable ONLY by service_role, so no client can grant itself premium.
--
-- The Edge Function (supabase/functions/revenuecat-webhook) is the only caller.

-- ---------------------------------------------------------------------------
-- 1. apply_play_subscription
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_play_subscription(
  p_user_id uuid,
  p_plan text,
  p_expires_at timestamptz,
  p_product_id text DEFAULT NULL,
  p_external_id text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $BODY$
DECLARE
  v_tier text;
  v_effective_expires timestamptz;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'user id required');
  END IF;

  -- Only the two paid tiers. 'free' and anything unrecognised are rejected here
  -- so a malformed webhook can never write a tier the client cannot render.
  IF p_plan NOT IN ('pro', 'business') THEN
    RETURN json_build_object('success', false, 'error', 'unknown plan: ' || coalesce(p_plan, 'null'));
  END IF;
  v_tier := p_plan;

  -- An entitlement with no expiry is exactly the state the client fails closed
  -- on (see profiles_paid_requires_expiry), so refuse it rather than write a
  -- row the app would immediately read as expired.
  IF p_expires_at IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'expires_at required for a paid tier');
  END IF;

  -- Never shorten an existing entitlement. A late-arriving webhook (or a
  -- replay) must not revoke time a user has already paid for.
  SELECT GREATEST(coalesce(subscription_expires_at, now()), p_expires_at)
  INTO v_effective_expires
  FROM public.profiles
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'profile not found');
  END IF;

  UPDATE public.profiles
  SET subscription_tier      = v_tier,
      subscription_expires_at = v_effective_expires,
      subscription_auto_renew = true,
      last_payment_date      = NOW(),
      updated_at             = NOW()
  WHERE id = p_user_id;

  -- Audit / restore trail. The unique index on (user_id, payment_provider)
  -- makes this an upsert rather than an insert.
  IF p_external_id IS NOT NULL THEN
    INSERT INTO public.subscriptions
      (user_id, plan_id, payment_provider, external_id, status, started_at, expires_at)
    VALUES
      (p_user_id, v_tier, 'google_play', p_external_id, 'active', NOW(), v_effective_expires)
    ON CONFLICT (user_id, payment_provider) DO UPDATE
      SET plan_id     = EXCLUDED.plan_id,
          external_id = EXCLUDED.external_id,
          status      = 'active',
          expires_at  = EXCLUDED.expires_at,
          updated_at  = NOW();
  END IF;

  RETURN json_build_object(
    'success', true,
    'tier', v_tier,
    'expires_at', v_effective_expires
  );
END;
$BODY$;

-- ---------------------------------------------------------------------------
-- 2. expire_play_subscription
-- ---------------------------------------------------------------------------
-- Used when the store reports the subscription ended. The tier is downgraded but
-- the expiry is LEFT ALONE: profiles.subscription_expires_at is the record of
-- what was paid for, and isTierActive() already resolves a past date to
-- inactive. Zeroing it would erase the audit trail and break the fail-closed
-- reasoning that treats a paid row with NULL expiry as corrupt.
CREATE OR REPLACE FUNCTION public.expire_play_subscription(
  p_user_id uuid,
  p_external_id text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $BODY$
DECLARE
  v_still_covered boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'user id required');
  END IF;

  -- Another entitlement (a manual payment, a different store) may still be
  -- active; do not downgrade in that case.
  SELECT subscription_expires_at > now() INTO v_still_covered
  FROM public.profiles
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'profile not found');
  END IF;

  IF p_external_id IS NOT NULL THEN
    UPDATE public.subscriptions
    SET status = 'expired', updated_at = NOW()
    WHERE user_id = p_user_id
      AND payment_provider = 'google_play'
      AND (external_id = p_external_id OR external_id IS NULL);
  END IF;

  IF v_still_covered THEN
    RETURN json_build_object('success', true, 'downgraded', false,
                             'reason', 'another entitlement is still active');
  END IF;

  UPDATE public.profiles
  SET subscription_tier   = 'free',
      subscription_auto_renew = false,
      last_payment_date   = NULL,
      updated_at          = NOW()
  WHERE id = p_user_id;

  RETURN json_build_object('success', true, 'downgraded', true);
END;
$BODY$;

-- ---------------------------------------------------------------------------
-- 3. Lock both to service_role
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER without this revoke would let any authenticated user call
-- the function directly with their own id and grant themselves Pro.
REVOKE ALL ON FUNCTION public.apply_play_subscription(uuid, text, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_play_subscription(uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_play_subscription(uuid, text, timestamptz, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_play_subscription(uuid, text) TO service_role;

COMMENT ON FUNCTION public.apply_play_subscription(uuid, text, timestamptz, text, text) IS
  'Applies a Play/RevenueCat entitlement. Service-role only. Never shortens an existing expiry and never writes a paid tier with a NULL expiry.';
COMMENT ON FUNCTION public.expire_play_subscription(uuid, text) IS
  'Downgrades a Play entitlement that the store reported as ended, unless another entitlement is still covered. Leaves subscription_expires_at intact as the audit trail.';
