import { useEffect } from 'react';

import { adMobService } from '@/lib/ads/adMobService';
import { getPlanLimits } from '@/lib/subscription/planLimits';
import { useSubscriptionStore } from '@/stores/subscriptionStore';

/**
 * Keep the ad SDK's premium gate in sync with the user's entitlement.
 *
 * `adMobService.shouldShowAds()` already returns false for premium users, and
 * both the banner and the interstitial funnel go through it -- but
 * `setPremiumStatus()` was never called from anywhere, so paying subscribers
 * were still served ads. This hook is the missing link.
 *
 * It is a `useEffect` rather than a one-shot call in `_layout` so that a
 * purchase, restore, downgrade or expiry re-evaluates automatically. The store
 * already downgrades a past-expiry paid tier to 'free' when it hydrates, so
 * `currentTier` is the expiry-correct tier and no date maths is needed here.
 */
export function useAdEntitlementSync(): void {
  const currentTier = useSubscriptionStore((s) => s.currentTier);

  useEffect(() => {
    adMobService.setPremiumStatus(getPlanLimits(currentTier).hasAdFree);
  }, [currentTier]);
}
