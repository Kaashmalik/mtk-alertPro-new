-- Enforce the invariant that client-side entitlement checks rely on.
--
-- Background: src/lib/subscription/planLimits.ts#isTierActive() fails closed --
-- a paid tier with a missing/unparseable subscription_expires_at resolves to
-- inactive. That keeps a partially-written row from granting premium forever,
-- but it is only safe because of what this migration pins down.
--
-- Why the invariant holds without it being written anywhere:
--   * profiles.subscription_tier is CHECK-constrained to free|pro|business.
--     There is no 'lifetime' tier, so NULL expiry cannot mean "lifetime".
--   * confirm_payment() always assigns subscription_expires_at when promoting
--     a row to a paid plan.
--   * downgrade_subscription() resets tier='free' and expires_at=NULL together,
--     never leaving a paid tier behind a NULL expiry.
--
-- So "paid tier, no expiry" is unreachable in practice. Writing the CHECK turns
-- that from a convention into a guarantee, so a future migration or a manual
-- console edit cannot reintroduce a row that the client would disagree with
-- the database about.
--
-- Lifetime entitlements, if they are ever productised, must be stored as a
-- far-future timestamp (e.g. '2999-12-31') rather than NULL.
--
-- Pre-flight check on 2026-09-29 against production:
--   profiles where subscription_tier <> 'free' AND subscription_expires_at IS NULL -> 0 rows.
-- The repair below is therefore a no-op today; it exists so the ALTER cannot
-- fail on a row created after this comment was written.

-- ---------------------------------------------------------------------------
-- 1. Repair (defensive, currently a no-op)
-- ---------------------------------------------------------------------------
-- An unverifiable paid row is normalised to 'free' rather than being given a
-- fabricated expiry. This is not a downgrade a user can observe: the client
-- already resolves such a row to inactive and renders Free, so the database
-- simply starts agreeing with what the app has been showing all along.
-- Any user actually affected would need their entitlement re-granted through
-- confirm_payment(), not through an invented date.
UPDATE public.profiles
SET subscription_tier   = 'free',
    subscription_auto_renew = false,
    updated_at          = NOW()
WHERE subscription_tier <> 'free'
  AND subscription_expires_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. The constraint
-- ---------------------------------------------------------------------------
-- NOT VALID would let existing bad rows pass, which defeats the purpose;
-- since the repair above runs first, VALID is safe.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_paid_requires_expiry;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_paid_requires_expiry
  CHECK (subscription_tier = 'free' OR subscription_expires_at IS NOT NULL);

COMMENT ON CONSTRAINT profiles_paid_requires_expiry ON public.profiles IS
  'A paid tier must carry an expiry. isTierActive() fails closed on a missing expiry, so this constraint is what makes that safe: a paid row can never exist in a state the client would read as inactive. Store lifetime plans as a far-future timestamp, not NULL.';
