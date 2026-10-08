/**
 * Plan limit tests
 *
 * This module is the entitlement boundary, so the tests focus on the two
 * properties that keep it safe: failing closed on unknown input, and treating
 * an expired subscription as inactive.
 *
 * @jest-environment node
 */

import {
  MAX_AUTOMATIONS,
  MAX_CONCURRENT_STREAMS,
  PLAN_LIMITS,
  canAddCamera,
  canCreateAutomation,
  canUseFeature,
  clampStreamQuality,
  describeCameraLimit,
  getPlanLimits,
  isPaidTier,
  isTierActive,
  maxResolutionForTier,
  maxStreamQuality,
  normalizeTier,
  remainingCameras,
  resolveEffectiveQuality,
} from '@/lib/subscription/planLimits';

const FUTURE = new Date(Date.now() + 86_400_000);
const PAST = new Date(Date.now() - 86_400_000);

describe('planLimits', () => {
  describe('normalizeTier', () => {
    it('keeps known tiers', () => {
      expect(normalizeTier('free')).toBe('free');
      expect(normalizeTier('pro')).toBe('pro');
      expect(normalizeTier('business')).toBe('business');
    });

    it('falls back to free for unknown values', () => {
      // Regression guard: an unrecognised tier previously flowed through a cast
      // into entitlement checks.
      expect(normalizeTier('enterprise')).toBe('free');
      expect(normalizeTier(undefined)).toBe('free');
      expect(normalizeTier(null)).toBe('free');
      expect(normalizeTier(42)).toBe('free');
      expect(normalizeTier({})).toBe('free');
      expect(normalizeTier('PRO')).toBe('free');
    });
  });

  describe('getPlanLimits', () => {
    it('returns the free limits for an unknown tier (fail closed)', () => {
      expect(getPlanLimits('enterprise')).toBe(PLAN_LIMITS.free);
      expect(getPlanLimits(undefined)).toBe(PLAN_LIMITS.free);
    });
  });

  describe('isPaidTier', () => {
    it('treats only pro and business as paid', () => {
      expect(isPaidTier('pro')).toBe(true);
      expect(isPaidTier('business')).toBe(true);
      expect(isPaidTier('free')).toBe(false);
      expect(isPaidTier('enterprise')).toBe(false);
    });
  });

  describe('isTierActive', () => {
    it('is false for free', () => {
      expect(isTierActive('free', FUTURE)).toBe(false);
      expect(isTierActive('free', null)).toBe(false);
    });

    it('is true for a paid tier with a future expiry', () => {
      expect(isTierActive('pro', FUTURE)).toBe(true);
      expect(isTierActive('business', FUTURE)).toBe(true);
    });

    it('is false for a paid tier past its expiry', () => {
      // Regression guard: useIsPremium compared only the tier string, so an
      // expired subscription kept granting paid features.
      expect(isTierActive('pro', PAST)).toBe(false);
      expect(isTierActive('business', PAST)).toBe(false);
    });

    it('accepts ISO strings as well as Dates', () => {
      expect(isTierActive('pro', FUTURE.toISOString())).toBe(true);
      expect(isTierActive('pro', PAST.toISOString())).toBe(false);
    });

    it('is false for an unparseable expiry', () => {
      expect(isTierActive('pro', 'not-a-date')).toBe(false);
    });

    it('is false for a paid tier with no expiry (fail closed)', () => {
      // profiles.subscription_tier is CHECK-constrained to free|pro|business
      // (no lifetime tier), confirm_payment always writes an expiry, and
      // downgrade_subscription() resets tier='free' + expiry=NULL together.
      // A paid row with NULL expiry is therefore unreachable, and treating it
      // as active would let a partially-written row grant premium forever.
      // Lifetime entitlements, if ever needed, must be stored as a far-future
      // timestamp rather than NULL.
      expect(isTierActive('pro', null)).toBe(false);
      expect(isTierActive('business', null)).toBe(false);
      expect(isTierActive('pro', undefined)).toBe(false);
    });

    it('is false for an unknown tier even with a future expiry', () => {
      expect(isTierActive('enterprise', FUTURE)).toBe(false);
    });
  });

  describe('canAddCamera', () => {
    it('enforces the free limit of 2', () => {
      expect(canAddCamera('free', 0)).toBe(true);
      expect(canAddCamera('free', 1)).toBe(true);
      expect(canAddCamera('free', 2)).toBe(false);
      expect(canAddCamera('free', 3)).toBe(false);
    });

    it('allows unlimited cameras on paid tiers', () => {
      expect(canAddCamera('pro', 500)).toBe(true);
      expect(canAddCamera('business', 500)).toBe(true);
    });

    it('caps an unknown tier at the free quota rather than unlimited', () => {
      // Regression guard. The old check was `n >= limits[tier]`, and for an
      // unrecognised tier `limits[tier]` is undefined, so `n >= undefined` is
      // false and the check passed for ANY n - i.e. it failed OPEN and allowed
      // unlimited cameras. Normalising to free means an unknown tier gets the
      // free quota of 2 and no more.
      expect(canAddCamera('enterprise', 0)).toBe(true);
      expect(canAddCamera('enterprise', 1)).toBe(true);
      expect(canAddCamera('enterprise', 2)).toBe(false);
      expect(canAddCamera('enterprise', 500)).toBe(false);
      expect(canAddCamera(undefined, 2)).toBe(false);
    });
  });

  describe('remainingCameras', () => {
    it('computes the remaining slots', () => {
      expect(remainingCameras('free', 0)).toBe(2);
      expect(remainingCameras('free', 1)).toBe(1);
      expect(remainingCameras('free', 2)).toBe(0);
    });

    it('never goes negative when already over the limit', () => {
      expect(remainingCameras('free', 5)).toBe(0);
    });

    it('is Infinity for unlimited tiers', () => {
      expect(remainingCameras('pro', 99)).toBe(Number.POSITIVE_INFINITY);
    });
  });

  describe('canUseFeature', () => {
    it('reads boolean entitlements from the plan', () => {
      expect(canUseFeature('free', 'hasCustomZones')).toBe(false);
      expect(canUseFeature('pro', 'hasCustomZones')).toBe(true);
      expect(canUseFeature('business', 'hasAPIAccess')).toBe(true);
      expect(canUseFeature('free', 'hasAPIAccess')).toBe(false);
    });

    it('does not grant paid entitlements to an unknown tier', () => {
      expect(getPlanLimits('enterprise')).toBe(PLAN_LIMITS.free);
      expect(canUseFeature('enterprise', 'hasCustomZones')).toBe(false);
      expect(canUseFeature('enterprise', 'hasAPIAccess')).toBe(false);
      expect(maxStreamQuality('enterprise')).toBe('sd');
    });

    it('gives face recognition to paid tiers only', () => {
      expect(PLAN_LIMITS.free.hasFaceRecognition).toBe(false);
      expect(PLAN_LIMITS.pro.hasFaceRecognition).toBe(true);
      expect(PLAN_LIMITS.business.hasFaceRecognition).toBe(true);
    });
  });

  describe('canCreateAutomation', () => {
    it('enforces the per-tier automation quota', () => {
      expect(canCreateAutomation('free', MAX_AUTOMATIONS.free - 1)).toBe(true);
      expect(canCreateAutomation('free', MAX_AUTOMATIONS.free)).toBe(false);
      expect(canCreateAutomation('pro', MAX_AUTOMATIONS.pro - 1)).toBe(true);
      expect(canCreateAutomation('pro', MAX_AUTOMATIONS.pro)).toBe(false);
      expect(canCreateAutomation('business', 10_000)).toBe(true);
    });

    it('caps an unknown tier at the free quota', () => {
      expect(canCreateAutomation('enterprise', 0)).toBe(true);
      expect(canCreateAutomation('enterprise', MAX_AUTOMATIONS.free)).toBe(
        false,
      );
      expect(canCreateAutomation('enterprise', 10_000)).toBe(false);
    });
  });

  describe('clampStreamQuality', () => {
    it('clamps a request above the plan ceiling', () => {
      expect(clampStreamQuality('free', '4k')).toBe('sd');
      expect(clampStreamQuality('free', 'hd')).toBe('sd');
      expect(clampStreamQuality('pro', '4k')).toBe('hd');
    });

    it('allows a request at or below the ceiling', () => {
      expect(clampStreamQuality('free', 'sd')).toBe('sd');
      expect(clampStreamQuality('pro', 'hd')).toBe('hd');
      expect(clampStreamQuality('business', '4k')).toBe('4k');
    });

    it('falls back to the ceiling for an unrecognised quality', () => {
      expect(clampStreamQuality('pro', '8k' as never)).toBe('hd');
    });

    it('never exceeds the ceiling for an unknown tier', () => {
      expect(maxStreamQuality('enterprise')).toBe('sd');
      expect(clampStreamQuality('enterprise', '4k')).toBe('sd');
    });
  });

  describe('maxResolutionForTier / resolveEffectiveQuality', () => {
    it('maps the plan ceiling to a concrete resolution', () => {
      // free => sd ceiling => 480p is the highest 'sd' bucket we expose
      expect(maxResolutionForTier('free')).toBe('480p');
      expect(maxResolutionForTier('pro')).toBe('720p');
      expect(maxResolutionForTier('business')).toBe('1080p');
    });

    it('caps a 1080p network recommendation at the plan ceiling', () => {
      // The regression this guards: getRecommendedQuality() always answered
      // 1080p on Wi-Fi and nothing applied the plan, so free pulled Pro res.
      expect(resolveEffectiveQuality('free', '1080p')).toBe('480p');
      expect(resolveEffectiveQuality('pro', '1080p')).toBe('720p');
      expect(resolveEffectiveQuality('business', '1080p')).toBe('1080p');
    });

    it('never upgrades a low recommendation above the plan ceiling', () => {
      // A constrained network stays low even for business.
      expect(resolveEffectiveQuality('business', '360p')).toBe('360p');
      expect(resolveEffectiveQuality('free', '360p')).toBe('360p');
      expect(resolveEffectiveQuality('pro', '480p')).toBe('480p');
    });

    it('treats an unknown tier as free (fail closed)', () => {
      expect(resolveEffectiveQuality('enterprise', '1080p')).toBe('480p');
    });
  });

  describe('limits table', () => {
    it('defines quotas for every tier', () => {
      for (const tier of ['free', 'pro', 'business'] as const) {
        expect(MAX_AUTOMATIONS[tier]).toBeGreaterThan(0);
        expect(MAX_CONCURRENT_STREAMS[tier]).toBeGreaterThan(0);
        expect(PLAN_LIMITS[tier]).toBeDefined();
      }
    });

    it('is monotonic across tiers', () => {
      expect(MAX_CONCURRENT_STREAMS.free).toBeLessThan(
        MAX_CONCURRENT_STREAMS.pro,
      );
      expect(MAX_CONCURRENT_STREAMS.pro).toBeLessThan(
        MAX_CONCURRENT_STREAMS.business,
      );
      expect(MAX_AUTOMATIONS.free).toBeLessThan(MAX_AUTOMATIONS.pro);
    });
  });

  describe('describeCameraLimit', () => {
    it('names the actual limit', () => {
      expect(describeCameraLimit('free')).toContain('2');
    });

    it('does not advertise a limit for unlimited tiers', () => {
      expect(describeCameraLimit('pro')).toBe('Unlimited cameras');
    });
  });
});
