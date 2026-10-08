# Admin & subscription controls

Adds a first-class **admin role** so a trusted operator can review manual
payment requests and manage subscriptions from inside the app ??? without ever
handing out the Supabase `service_role` key.

## Making someone an admin

`profiles.is_admin` is **not** client-writable (the RLS hardening migration
revoked client UPDATE on subscription/role columns, and `is_admin` is
deliberately excluded from the `authenticated` column grant). Set it with the
service role, e.g. in the Supabase SQL editor:

```sql
update public.profiles set is_admin = true where email = 'you@example.com';
```

## What an admin can do (in-app: Settings ??? Admin Console)

- **Pending payments** ??? see every `payment_requests` row still `pending`, and
  **Approve** (extends the user's subscription + writes `payment_history`) or
  **Reject** (with a reason).
- **Set subscription** ??? manually grant or revoke a tier (`free`/`pro`/
  `business`) for a given user id, for N months. Use for comps, refunds, or
  support fixes.

## Security model

- `private.is_admin()` ??? a `SECURITY DEFINER` helper that reads the flag while
  bypassing RLS, so admin read-policies on `profiles` don't recurse.
- Admin **read** policies let admins `SELECT` all profiles / payment rows; the
  existing user-scoped policies are untouched, so regular users still only see
  their own.
- Every privileged action is a `SECURITY DEFINER` RPC
  (`admin_confirm_payment`, `admin_reject_payment`, `admin_set_subscription`)
  whose **first statement** is `if not private.is_admin() then return
  not_authorized`. Being granted `EXECUTE` is not enough ??? the caller must
  actually be an admin. So a non-admin who force-navigates to the screen can
  read nothing (RLS) and change nothing (RPC guard).

## Migration

`supabase/migrations/20260928000000_admin_roles.sql`. Apply with
`supabase db push` (or `supabase migration up`) on deploy.
