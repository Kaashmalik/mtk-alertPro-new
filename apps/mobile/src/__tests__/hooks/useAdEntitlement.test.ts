import { renderHook } from '@testing-library/react-native';

import { useAdEntitlementSync } from '@/hooks/useAdEntitlement';
import { adMobService } from '@/lib/ads/adMobService';
import { PLAN_LIMITS } from '@/lib/subscription/planLimits';
import { useSubscriptionStore } from '@/stores/subscriptionStore';

jest.mock('@/lib/ads/adMobService', () => ({
  adMobService: { setPremiumStatus: jest.fn() },
}));

const setPremiumStatus = adMobService.setPremiumStatus as jest.Mock;

describe('useAdEntitlementSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSubscriptionStore.setState({ currentTier: 'free' });
  });

  it('shows ads to a free user', () => {
    renderHook(() => useAdEntitlementSync());
    expect(setPremiumStatus).toHaveBeenCalledWith(false);
  });

  it('suppresses ads for pro and business', () => {
    for (const tier of ['pro', 'business'] as const) {
      jest.clearAllMocks();
      useSubscriptionStore.setState({ currentTier: tier });
      renderHook(() => useAdEntitlementSync());
      expect(setPremiumStatus).toHaveBeenCalledWith(true);
    }
  });

  it('re-evaluates when the tier changes, so expiry restores ads', () => {
    const { rerender } = renderHook(() => useAdEntitlementSync());
    expect(setPremiumStatus).toHaveBeenLastCalledWith(false);

    // A purchase or restore upgrades the tier.
    useSubscriptionStore.setState({ currentTier: 'pro' });
    rerender(undefined);
    expect(setPremiumStatus).toHaveBeenLastCalledWith(true);

    // The store downgrades a past-expiry paid tier to 'free' on hydration,
    // which must re-enable ads rather than leave a lapsed subscriber ad-free.
    useSubscriptionStore.setState({ currentTier: 'free' });
    rerender(undefined);
    expect(setPremiumStatus).toHaveBeenLastCalledWith(false);
  });

  it('only grants ad-free to tiers that are actually entitled', () => {
    expect(PLAN_LIMITS.free.hasAdFree).toBe(false);
    expect(PLAN_LIMITS.pro.hasAdFree).toBe(true);
    expect(PLAN_LIMITS.business.hasAdFree).toBe(true);
  });
});
