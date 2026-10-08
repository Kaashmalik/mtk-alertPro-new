# RevenueCat / Google Play setup

The Play entitlement path is deployed and verified end-to-end. What remains is
configuration in two places that only the account owner can do.

## 1. What is already live

| Piece | Status |
|---|---|
| `supabase/functions/revenuecat-webhook` | Deployed, `ACTIVE`, `verify_jwt = false` |
| `RC_WEBHOOK_SECRET` | Set as a function secret (never in the repo) |
| `apply_play_subscription()` | Service-role-only RPC, verified |
| `expire_play_subscription()` | Service-role-only RPC, verified |

Verified behaviours (live, against production):

- Missing or wrong `Authorization` header → `401`, no state change
- `INITIAL_PURCHASE` → `profiles.subscription_tier = 'pro'`, expiry from the
  store's own `expiration_at_ms`
- `RENEWAL` → extends the existing expiry (30d → 60d in the test)
- An unmapped `product_id` → `422` and **never** grants, so a paid customer who
  is not being served is loud in the logs rather than silent
- `EXPIRATION` → downgrades to Free, but only once the paid period has actually
  ended (another active entitlement is not cancelled)
- A grant never *shortens* an expiry, so a replayed or late webhook cannot
  revoke time already paid for
- `anon` and `authenticated` **cannot** call the RPCs; only `service_role` can

## 2. What you must do

### A. RevenueCat dashboard

1. Project → **Webhooks** → add destination:

   ```
   https://oweettvrcmywlystsjxa.supabase.co/functions/v1/revenuecat-webhook
   ```

2. Set the **Authorization header** to the shared secret (see `RC_WEBHOOK_SECRET`
   in your password manager — it is deliberately not in this repo):

   ```
   Bearer <RC_WEBHOOK_SECRET>
   ```

3. Select these events:
   `INITIAL_PURCHASE`, `RENEWAL`, `PRODUCT_CHANGE`, `SUBSCRIPTION_EXTENDED`,
   `UNCANCELLATION`, `TRANSFER`, `CANCELLATION`, `EXPIRATION`, `BILLING_ISSUE`

4. **API Keys → Secret** in RevenueCat → app → environment.

### B. Product IDs

`apps/mobile/src/lib/subscription/revenueCat.ts` currently maps:

| Plan | Client product id | Webhook mapping |
|---|---|---|
| Pro monthly | `pro_monthly` | `pro` |
| Business monthly | `business_monthly` | `business` |

The webhook also accepts `pro_annual` / `business_annual` (and `*_yearly`) for
the annual pricing added to the paywall — create those products in Play Console
if you want annual billing, otherwise the monthly ids are enough.

**The product ids must match exactly** in three places or a purchase will 422:
the Play Console listing, the RevenueCat offering, and the tables above.

### C. Play Console

- Products must be **active** (or the offering will not resolve and
  `isPlayBillingAvailable()` returns false, hiding the Google Play option).
- The app needs `EXPO_PUBLIC_REVENUECAT_API_KEY` set as an EAS secret.

## 3. How to test without real money

Use a RevenueCat **sandbox** test purchase (Google Play Console → Subscriptions
→ your product → Test → Sandbox → New subscription). Confirm:

1. The webhook fires and returns `200 {"action":"grant"}`.
2. `select subscription_tier, subscription_expires_at from profiles` shows the
   new tier and a future expiry.
3. The app reflects Pro after `subscriptionService.initialize()` (or a restart —
   the webhook is the source of truth, the client never self-grants).

If step 1 returns `422 unmapped product_id`, the ids do not match (section B).
If it returns `500 server not configured`, `RC_WEBHOOK_SECRET` is not set.

## 4. Rollout note

Granting is idempotent and monotonic (see "never shortens" above), so replaying
a webhook is safe. Before enabling for real users, consider adding a dead-letter
log: the function currently returns `500` on an RPC failure, and RevenueCat
retries, which is the desired behaviour for transient errors.
