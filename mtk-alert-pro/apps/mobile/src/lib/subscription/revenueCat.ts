/**
 * RevenueCat / Google Play Billing bridge.
 *
 * Play Billing is the primary (and policy-compliant) purchase path for digital
 * subscriptions on the Play Store. The manual PK providers (WhatsApp,
 * EasyPaisa, JazzCash, bank transfer) remain as a fallback, so this module
 * must degrade cleanly when it is not configured.
 *
 * Everything here is fail-soft: if the native module is missing (Expo Go), the
 * API key is absent, or no products are configured, `isPlayBillingAvailable()`
 * stays false and the UI never shows the Google Play option.
 */

import { logError } from '@/lib/utils/errorHandler';

const API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY;

export type RevenueCatPlan = 'pro' | 'business';

/**
 * Plan id -> RevenueCat product identifier.
 *
 * The in-app plan model is monthly (`pro`, `business`), so the store products
 * mirror that. Adjust the product ids here to match whatever is configured in
 * the Play Console.
 */
const PRODUCT_ENTITLEMENTS: Record<RevenueCatPlan, { productId: string; tier: RevenueCatPlan }> = {
  pro: { productId: 'pro_monthly', tier: 'pro' },
  business: { productId: 'business_monthly', tier: 'business' },
};

let configured = false;
let availableProductIds: string[] = [];

// Dynamic require so Expo Go (no native module) and web both still bundle.
function loadPurchases(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-purchases');
    return mod?.default ?? mod ?? null;
  } catch {
    return null;
  }
}

/**
 * Configure the RevenueCat SDK. Safe to call repeatedly.
 * @returns true when the SDK is configured and reachable.
 */
export async function initRevenueCat(appUserId?: string): Promise<boolean> {
  if (configured) return true;

  if (!API_KEY || API_KEY.includes('your-revenuecat')) {
    console.log('[RevenueCat] Skipped - API key not configured; manual payment methods remain available');
    return false;
  }

  const Purchases = loadPurchases();
  if (!Purchases) {
    console.warn('[RevenueCat] Native module unavailable (Expo Go or not rebuilt)');
    return false;
  }

  try {
    Purchases.configure({ apiKey: API_KEY, appUserID: appUserId });

    // Reflect the real customer identity so purchases reconcile with the
    // backend rather than an anonymous device id.
    try {
      if (Purchases.logIn && appUserId) {
        await Purchases.logIn(appUserId);
      }
    } catch (e) {
      // A device already logged in under a different id throws; not fatal.
      console.warn('[RevenueCat] logIn skipped:', e);
    }

    try {
      const info = await Purchases.getCustomerInfo();
      availableProductIds = Object.values(info?.allPurchases ?? {});
    } catch {
      availableProductIds = [];
    }

    configured = true;
    console.log('[RevenueCat] Configured');
    return true;
  } catch (e) {
    console.warn('[RevenueCat] configure failed:', e);
    logError(e, 'revenueCat.initRevenueCat');
    return false;
  }
}

/**
 * True when a real Play Billing purchase can be started. Drives whether the
 * "Google Play" payment option is offered at all.
 */
export async function isPlayBillingAvailable(): Promise<boolean> {
  if (!configured) return false;
  const Purchases = loadPurchases();
  if (!Purchases) return false;
  try {
    const offerings = await Purchases.getOfferings();
    const available = offerings?.current?.availablePackages?.length ?? 0;
    return available > 0;
  } catch {
    return false;
  }
}

/**
 * Product ids that exist in the store, so the UI can map them to tiers.
 */
export function getKnownProductIds(): string[] {
  return Object.values(PRODUCT_ENTITLEMENTS).map((p) => p.productId);
}

export function getAlreadyPurchasedProductIds(): string[] {
  return [...availableProductIds];
}

/**
 * Purchase the package matching `planId`.
 *
 * @returns null on success-with-no-action, or an error object. The caller must
 *          treat `userCancelled` as a non-error.
 */
export async function purchasePlan(
  planId: RevenueCatPlan
): Promise<
  | { status: 'success'; tier: string; transactionId: string }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }
> {
  if (!configured) {
    return { status: 'error', message: 'Play Billing is not configured' };
  }
  const Purchases = loadPurchases();
  if (!Purchases) {
    return { status: 'error', message: 'Billing module unavailable' };
  }

  const entitlement = PRODUCT_ENTITLEMENTS[planId];
  if (!entitlement) {
    return { status: 'error', message: `Unknown plan: ${planId}` };
  }

  try {
    const offerings = await Purchases.getOfferings();
    const packages: any[] = offerings?.current?.availablePackages ?? [];
    const match =
      packages.find((p) => p.productIdentifier === entitlement.productId) ??
      packages.find((p) => String(p.productIdentifier ?? '').includes(planId));

    if (!match) {
      return {
        status: 'error',
        message: `${entitlement.productId} is not available in the Play Store yet`,
      };
    }

    const { customerInfo, userCancelled } = await Purchases.purchasePackage(match);
    if (userCancelled) return { status: 'cancelled' };

    const entitlementIds: string[] = customerInfo?.entitlements?.active ?? [];
    const active = entitlementIds.includes('pro') || match.productIdentifier === entitlement.productId;

    if (!active) {
      return { status: 'error', message: 'Purchase completed but entitlement is not active' };
    }

    return {
      status: 'success',
      tier: entitlement.tier,
      transactionId: customerInfo?.latestPurchaseDate ?? 'play',
    };
  } catch (e: any) {
    if (e?.userCancelled || e?.code === 'PURCHASE_CANCELLED_ERROR') {
      return { status: 'cancelled' };
    }
    console.error('[RevenueCat] purchase failed:', e);
    logError(e, 'revenueCat.purchasePlan');
    return { status: 'error', message: e?.message ?? 'Purchase failed' };
  }
}

/**
 * Record a Play purchase for server-side verification.
 *
 * This deliberately writes a *pending* row and nothing more. The RLS hardening
 * migration revoked the client's ability to write `profiles.subscription_tier`,
 * and that is correct: a client that can grant itself premium is a client any
 * attacker can impersonate. Promotion to 'active' happens when a trusted
 * endpoint (RevenueCat webhook -> Edge Function holding the secret key)
 * verifies the purchase and flips the profile tier.
 *
 * Until that endpoint is deployed, Google Play is not offered and the manual
 * providers remain the upgrade path.
 *
 * @returns true when the purchase was queued for verification.
 */
export async function recordPendingPurchase(
  userId: string,
  tier: string,
  transactionId: string
): Promise<boolean> {
  try {
    const { supabase } = await import('@/lib/supabase/client');
    const { error } = await supabase
      .from('subscriptions')
      .upsert(
        {
          user_id: userId,
          plan_id: tier,
          payment_provider: 'google_play',
          external_id: transactionId,
          // RLS pins client inserts to 'pending'.
          status: 'pending',
          updated_at: new Date().toISOString(),
        },
        // Must match the unique index on (user_id, payment_provider).
        { onConflict: 'user_id,payment_provider' }
      );
    if (error) throw error;
    return true;
  } catch (e) {
    console.error('[RevenueCat] could not queue purchase for verification:', e);
    logError(e, 'revenueCat.recordPendingPurchase');
    return false;
  }
}
