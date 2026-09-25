-- ============================================================================
-- SECURITY: prevent self-service premium upgrades
--
-- 1. profiles: users may only UPDATE profile-display columns, never
--    subscription_tier / subscription_expires_at / payment metadata.
--    Admin + SECURITY DEFINER functions (confirm_payment) run as the table
--    owner / service_role and are unaffected.
-- 2. confirm_payment: executable only by service_role (backend/admin), and
--    only for payments still in 'pending' status.
-- 3. payment_requests: clients may only insert rows with status = 'pending'.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Column-level UPDATE grants on profiles
-- ---------------------------------------------------------------------------
REVOKE UPDATE ON public.profiles FROM anon, authenticated;

GRANT UPDATE (
  display_name,
  avatar_url,
  fcm_token,
  updated_at
) ON public.profiles TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Lock down confirm_payment
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.confirm_payment(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_payment(uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.confirm_payment(
  p_payment_request_id uuid,
  p_transaction_id text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment payment_requests%ROWTYPE;
  v_new_expires_at timestamp with time zone;
BEGIN
  SELECT * INTO v_payment
  FROM payment_requests
  WHERE id = p_payment_request_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Payment request not found');
  END IF;

  IF v_payment.status <> 'pending' THEN
    RETURN json_build_object('success', false, 'error', 'Payment is not pending');
  END IF;

  SELECT GREATEST(
    subscription_expires_at,
    now()
  ) + interval '1 month'
  INTO v_new_expires_at
  FROM profiles
  WHERE id = v_payment.user_id;

  IF v_new_expires_at IS NULL THEN
    v_new_expires_at := now() + interval '1 month';
  END IF;

  UPDATE payment_requests
  SET
    status = 'completed',
    transaction_id = p_transaction_id,
    completed_at = now(),
    updated_at = now()
  WHERE id = p_payment_request_id;

  UPDATE profiles
  SET
    subscription_tier = v_payment.plan_id,
    subscription_expires_at = v_new_expires_at,
    last_payment_date = now(),
    updated_at = now()
  WHERE id = v_payment.user_id;

  INSERT INTO payment_history (
    user_id,
    payment_request_id,
    amount,
    currency,
    plan_id,
    period_start,
    period_end
  ) VALUES (
    v_payment.user_id,
    p_payment_request_id,
    v_payment.amount,
    v_payment.currency,
    v_payment.plan_id,
    now(),
    v_new_expires_at
  );

  RETURN json_build_object(
    'success', true,
    'expires_at', v_new_expires_at,
    'plan', v_payment.plan_id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. payment_requests: clients can only create pending rows for themselves
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can create their own payment requests"
  ON payment_requests;

CREATE POLICY "Users can create their own payment requests"
  ON payment_requests FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND status = 'pending'
  );
