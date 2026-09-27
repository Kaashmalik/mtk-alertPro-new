-- Google Play / RevenueCat subscription bookkeeping, plus the self-service
-- downgrade path.
--
-- Why this migration exists:
--
-- 1. The Play Billing client (src/lib/subscription/revenueCat.ts) upserts into a
--    `subscriptions` table that was never created by any earlier migration, so
--    the sync silently 404'd. This creates it.
--
-- 2. rls_subscription_hardening.sql revoked column-level UPDATE on `profiles`
--    for everything except display columns, so the app could no longer
--    downgrade itself. `downgrade_subscription()` is the SECURITY DEFINER
--    replacement, scoped to the caller's own row.
--
-- 3. A client must not be able to grant itself premium. The RLS hardening
--    exists precisely to stop that, so the client may only write a
--    *pending* record. Promoting it to 'active' and flipping
--    profiles.subscription_tier is a server-side job (RevenueCat webhook ->
--    Edge Function holding the secret API key). Until that endpoint exists,
--    Google Play stays unavailable and the manual providers remain in charge.

-- ---------------------------------------------------------------------------
-- 1. subscriptions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL,
  payment_provider TEXT NOT NULL
    CHECK (payment_provider IN ('google_play', 'whatsapp', 'easypaisa', 'jazzcash', 'bank')),
  -- RevenueCat transaction / purchase token.
  external_id TEXT,
  -- Client may only ever create 'pending'. 'active' is set server-side.
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'cancelled', 'expired')),
  started_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.subscriptions IS
  'Play/RevenueCat purchase records. Rows are created pending by the client and activated server-side after verification.';

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id
  ON public.subscriptions (user_id);

-- One live subscription per user per provider; re-purchasing updates the row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_user_provider
  ON public.subscriptions (user_id, payment_provider);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own subscriptions" ON public.subscriptions;
CREATE POLICY "Users can read their own subscriptions"
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id);

-- INSERT is allowed but pinned to 'pending' for the caller's own row, so a
-- tampered client cannot write itself an active subscription.
DROP POLICY IF EXISTS "Users can create their own pending subscription" ON public.subscriptions;
CREATE POLICY "Users can create their own pending subscription"
  ON public.subscriptions FOR INSERT
  WITH CHECK (auth.uid() = user_id AND status = 'pending');

-- No UPDATE/DELETE policy for authenticated users: promotion and cancellation
-- are server-side concerns. Cancellation self-service goes through
-- downgrade_subscription() below.

-- ---------------------------------------------------------------------------
-- 2. Self-service downgrade (SECURITY DEFINER)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.downgrade_subscription()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();

  IF v_uid IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Only ever touches the caller's own row.
  UPDATE public.profiles
  SET subscription_tier = 'free',
      subscription_expires_at = NULL,
      subscription_auto_renew = false,
      last_payment_date = NULL,
      updated_at = NOW()
  WHERE id = v_uid;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Profile not found');
  END IF;

  -- Mark any in-flight paid subscriptions cancelled so a stale 'active' row
  -- cannot be mistaken for entitlement later.
  UPDATE public.subscriptions
  SET status = 'cancelled', updated_at = NOW()
  WHERE user_id = v_uid AND status IN ('pending', 'active');

  RETURN json_build_object('success', true, 'plan', 'free');
END;
$$;

REVOKE ALL ON FUNCTION public.downgrade_subscription() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.downgrade_subscription() TO authenticated;
