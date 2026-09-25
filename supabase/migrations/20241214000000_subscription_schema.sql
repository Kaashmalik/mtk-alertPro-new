-- ============================================================================
-- Subscription & Payment Schema Updates
-- ============================================================================

-- Add subscription fields to profiles if not exists
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS subscription_auto_renew boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS subscription_payment_method text,
ADD COLUMN IF NOT EXISTS last_payment_date timestamp with time zone;

-- Create payment_requests table for tracking payment attempts
CREATE TABLE IF NOT EXISTS payment_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  plan_id text NOT NULL,
  amount numeric(10,2) NOT NULL,
  currency text DEFAULT 'PKR' NOT NULL,
  provider text NOT NULL,
  status text DEFAULT 'pending' NOT NULL,
  transaction_id text,
  payment_proof_url text,
  notes text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  completed_at timestamp with time zone
);

-- Create payment history table
CREATE TABLE IF NOT EXISTS payment_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  payment_request_id uuid REFERENCES payment_requests(id),
  amount numeric(10,2) NOT NULL,
  currency text DEFAULT 'PKR' NOT NULL,
  plan_id text NOT NULL,
  period_start timestamp with time zone NOT NULL,
  period_end timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create subscription_features table for feature flags
CREATE TABLE IF NOT EXISTS subscription_features (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tier text NOT NULL,
  feature_key text NOT NULL,
  feature_value text,
  is_enabled boolean DEFAULT true,
  UNIQUE(tier, feature_key)
);

-- Insert default feature flags
INSERT INTO subscription_features (tier, feature_key, feature_value, is_enabled) VALUES
  ('free', 'max_cameras', '2', true),
  ('free', 'max_alert_history_days', '7', true),
  ('free', 'ai_detection', 'true', true),
  ('free', 'face_recognition', 'false', false),
  ('free', 'custom_zones', 'false', false),
  ('free', 'priority_support', 'false', false),
  ('pro', 'max_cameras', 'unlimited', true),
  ('pro', 'max_alert_history_days', '30', true),
  ('pro', 'ai_detection', 'true', true),
  ('pro', 'face_recognition', 'true', true),
  ('pro', 'custom_zones', 'true', true),
  ('pro', 'priority_support', 'true', true),
  ('business', 'max_cameras', 'unlimited', true),
  ('business', 'max_alert_history_days', 'unlimited', true),
  ('business', 'ai_detection', 'true', true),
  ('business', 'face_recognition', 'true', true),
  ('business', 'custom_zones', 'true', true),
  ('business', 'priority_support', 'true', true),
  ('business', 'api_access', 'true', true)
ON CONFLICT (tier, feature_key) DO NOTHING;

-- Enable RLS on new tables
ALTER TABLE payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_features ENABLE ROW LEVEL SECURITY;

-- RLS Policies for payment_requests
CREATE POLICY "Users can view their own payment requests"
  ON payment_requests FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own payment requests"
  ON payment_requests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for payment_history
CREATE POLICY "Users can view their own payment history"
  ON payment_history FOR SELECT
  USING (auth.uid() = user_id);

-- RLS Policies for subscription_features (public read)
CREATE POLICY "Anyone can view subscription features"
  ON subscription_features FOR SELECT
  USING (true);

-- Create function to update subscription on payment confirmation
CREATE OR REPLACE FUNCTION confirm_payment(
  p_payment_request_id uuid,
  p_transaction_id text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_payment payment_requests%ROWTYPE;
  v_new_expires_at timestamp with time zone;
BEGIN
  -- Get payment request
  SELECT * INTO v_payment
  FROM payment_requests
  WHERE id = p_payment_request_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Payment request not found');
  END IF;

  IF v_payment.status = 'completed' THEN
    RETURN json_build_object('success', false, 'error', 'Payment already completed');
  END IF;

  -- Calculate new expiration (extend from current or now)
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

  -- Update payment request
  UPDATE payment_requests
  SET 
    status = 'completed',
    transaction_id = p_transaction_id,
    completed_at = now(),
    updated_at = now()
  WHERE id = p_payment_request_id;

  -- Update user profile
  UPDATE profiles
  SET 
    subscription_tier = v_payment.plan_id,
    subscription_expires_at = v_new_expires_at,
    last_payment_date = now(),
    updated_at = now()
  WHERE id = v_payment.user_id;

  -- Record in payment history
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

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_payment_requests_user_id ON payment_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_status ON payment_requests(status);
CREATE INDEX IF NOT EXISTS idx_payment_history_user_id ON payment_history(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_subscription_tier ON profiles(subscription_tier);
CREATE INDEX IF NOT EXISTS idx_profiles_subscription_expires_at ON profiles(subscription_expires_at);

