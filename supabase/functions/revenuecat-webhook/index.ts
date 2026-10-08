/**
 * RevenueCat webhook -> Supabase entitlement.
 *
 * This is the missing link that makes Google Play purchases actually grant
 * premium. Without it the client writes a `pending` subscriptions row and
 * nothing ever promotes it, because a client must not be able to grant itself
 * premium (see rls_subscription_hardening.sql). This function holds the server
 * authority and is the only caller of apply_play_subscription().
 *
 * Setup (one-time, in the RevenueCat dashboard):
 *   1. Add this URL as a webhook destination:
 *        https://<project-ref>.supabase.co/functions/v1/revenuecat-webhook
 *   2. Under "Authorization header", set it to: Bearer <RC_WEBHOOK_SECRET>
 *   3. Events: INITIAL_PURCHASE, RENEWAL, PRODUCT_CHANGE, CANCELLATION,
 *      EXPIRATION, BILLING_ISSUE, SUBSCRIPTION_EXTENDED, TRANSFER
 *   4. Set the shared secret as a function secret (never in the repo):
 *        supabase secrets set RC_WEBHOOK_SECRET=...
 *
 * The secret is compared in constant time and every unrecognised event shape is
 * rejected loudly rather than silently ignored — a silently-dropped webhook
 * looks identical to "no sales yet", which is exactly the failure this whole
 * path exists to avoid.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RC_WEBHOOK_SECRET = Deno.env.get('RC_WEBHOOK_SECRET') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

/** Store product id -> plan tier. Must mirror PRODUCT_ENTITLEMENTS on the client. */
const PRODUCT_TIERS: Record<string, 'pro' | 'business'> = {
  pro_monthly: 'pro',
  pro_annual: 'pro',
  pro_yearly: 'pro',
  business_monthly: 'business',
  business_annual: 'business',
  business_yearly: 'business',
};

/** Events that grant or extend an entitlement. */
const GRANT_EVENTS = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'SUBSCRIPTION_EXTENDED',
  'UNCANCELLATION',
  'TRANSFER',
]);

/** Events that end an entitlement. */
const REVOKE_EVENTS = new Set(['EXPIRATION', 'CANCELLATION', 'BILLING_ISSUE']);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

/** Constant-time string compare so the secret cannot be recovered by timing. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  // RevenueCat sends POST only, but keep CORS preflight cheap for debugging.
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405);
  }

  if (!RC_WEBHOOK_SECRET) {
    console.error(
      '[rc-webhook] RC_WEBHOOK_SECRET is not set — refusing all events',
    );
    return json({ error: 'server not configured' }, 500);
  }

  // --- authenticate -------------------------------------------------------
  // RevenueCat sends the configured header verbatim; require the Bearer form so
  // a misconfigured dashboard fails closed instead of accepting anything.
  const auth = req.headers.get('authorization') ?? '';
  const presented = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
  if (!safeEqual(presented, RC_WEBHOOK_SECRET)) {
    console.warn('[rc-webhook] rejected: bad authorization header');
    return json({ error: 'unauthorized' }, 401);
  }

  // --- parse --------------------------------------------------------------
  let event: Record<string, unknown>;
  try {
    event = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const type = String(event.type ?? '');
  const appUserId = String(event.app_user_id ?? '');
  const productId = String(event.product_id ?? '');
  const externalId = String(
    event.transaction_id ?? event.original_transaction_id ?? '',
  );

  if (!type) return json({ error: 'missing event type' }, 400);
  if (!appUserId) return json({ error: 'missing app_user_id' }, 400);

  // --- map product -> tier ------------------------------------------------
  const tier = PRODUCT_TIERS[productId];
  if (!tier) {
    // Loud on purpose: an unmapped product means a paid customer is not being
    // served, and this must not look like a routine no-op.
    console.error(
      `[rc-webhook] UNMAPPED product_id "${productId}" for event ${type}`,
    );
    return json({ error: `unmapped product_id: ${productId}` }, 422);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // --- revoke path --------------------------------------------------------
  if (REVOKE_EVENTS.has(type)) {
    const { data, error } = await supabase.rpc('expire_play_subscription', {
      p_user_id: appUserId,
      p_external_id: externalId || null,
    });
    if (error) {
      console.error('[rc-webhook] expire failed:', error);
      return json({ error: error.message }, 500);
    }
    console.log(`[rc-webhook] ${type} ->`, JSON.stringify(data));
    return json({ ok: true, action: 'expire', result: data });
  }

  // --- grant path ---------------------------------------------------------
  if (!GRANT_EVENTS.has(type)) {
    // Not an error: RevenueCat sends informational events too.
    console.log(`[rc-webhook] ignoring event ${type}`);
    return json({ ok: true, action: 'ignored', type });
  }

  // expiration_at_ms is the store's own answer for how long the user has paid
  // for. Trust it rather than recomputing a period here — that is the bug that
  // made confirm_payment() wrong for annual plans.
  const expiresAtMs = event.expiration_at_ms;
  if (typeof expiresAtMs !== 'number') {
    console.error(
      `[rc-webhook] ${type} has no expiration_at_ms — cannot grant`,
    );
    return json({ error: 'missing expiration_at_ms' }, 422);
  }
  const expiresAt = new Date(expiresAtMs).toISOString();

  const { data, error } = await supabase.rpc('apply_play_subscription', {
    p_user_id: appUserId,
    p_plan: tier,
    p_expires_at: expiresAt,
    p_product_id: productId,
    p_external_id: externalId || null,
  });

  if (error) {
    console.error('[rc-webhook] apply failed:', error);
    return json({ error: error.message }, 500);
  }

  const result = data as { success?: boolean; error?: string };
  if (result && result.success === false) {
    console.error(`[rc-webhook] apply refused: ${result.error}`);
    return json({ error: result.error }, 409);
  }

  console.log(`[rc-webhook] ${type} -> ${tier} until ${expiresAt}`);
  return json({ ok: true, action: 'grant', tier, expires_at: expiresAt });
});
