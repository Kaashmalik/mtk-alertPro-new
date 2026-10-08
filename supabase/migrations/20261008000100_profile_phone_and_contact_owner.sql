-- ============================================================================
-- Two client-facing column gaps that no earlier migration created.
--
-- Both are referenced by apps/mobile code but had no DDL anywhere in this
-- directory, so they failed at runtime against a database built purely from
-- migrations:
--
--   1. profiles.phone
--      lib/profile/profileService.ts reads it (getProfile) and writes it
--      (updateProfile), and app/profile/edit.tsx surfaces it. The insert/update
--      was rejected by Postgres with
--      `column "phone" of relation "profiles" does not exist`, which surfaced
--      to the user as "failed to save profile".
--
--   2. emergency_contacts.user_id had no default
--      lib/emergency/contactService.ts#addContact inserts
--      { name, phone, always_notify } and deliberately does NOT send user_id,
--      because the RLS policy already scopes every read/write to auth.uid().
--      The column is NOT NULL with no default and no trigger, so adding a
--      trusted contact raised a not-null violation and the contact was silently
--      never saved (addContact returns null on error).
--
-- Deriving the owner in the database is the fix for (2): it keeps the "the
-- owner is always the caller" guarantee in one place instead of trusting every
-- future writer to remember the column.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. profiles.phone
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone TEXT;

COMMENT ON COLUMN public.profiles.phone IS
  'Contact number shown on the profile screen. Free text: the app normalises and validates before saving, and never uses it as an identity factor.';

-- The column-level UPDATE grant from 20260923150000_rls_subscription_hardening.sql
-- is an allow-list, so a new column is NOT writable until it is named here.
-- is_admin is intentionally left out of this list.
GRANT UPDATE (phone) ON public.profiles TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. emergency_contacts.user_id defaults to the caller
-- ---------------------------------------------------------------------------
ALTER TABLE public.emergency_contacts
  ALTER COLUMN user_id SET DEFAULT auth.uid();

COMMENT ON COLUMN public.emergency_contacts.user_id IS
  'Owner. Defaults to auth.uid(), so clients may omit it on INSERT; the RLS policy still enforces auth.uid() = user_id.';

