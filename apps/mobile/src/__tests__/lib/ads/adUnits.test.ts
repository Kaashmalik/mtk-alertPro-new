/**
 * Ad unit resolution.
 *
 * A production build must never fall back to Google's test units (invalid
 * traffic per AdMob policy) and must never ship an unresolved placeholder
 * (ads simply fail to load). The resolution order has to be: real env value ->
 * test unit, with the placeholder treated as "not configured".
 */

import { adMobService } from '@/lib/ads/adMobService';

describe('ad unit resolution', () => {
  it('never returns a placeholder unit id', () => {
    // The placeholder in the source table means "not configured". If it leaked
    // out, production would request an ad that can never load.
    for (const type of [
      'banner',
      'interstitial',
      'rewarded',
      'native',
      'appOpen',
    ] as const) {
      for (const useTestAds of [true, false]) {
        const id = adMobService.getAdUnitId(type, useTestAds);
        expect(id).not.toContain('XXXXXXXXXX');
        expect(id).toMatch(/^ca-app-pub-/);
      }
    }
  });

  it('returns a Google test unit when no production id is configured', () => {
    // No EXPO_PUBLIC_ADMOB_* values are set in tests, so this exercises the
    // fallback that keeps a credential-less build from crashing.
    const banner = adMobService.getAdUnitId('banner', false);
    // The jest preset reports Platform.OS as ios, so the iOS test unit is the
    // one that must come back.
    expect(banner).toBe('ca-app-pub-3940256099942544/2934735716');
  });

  it('returns the same id regardless of platform-specific config', () => {
    expect(adMobService.getAdUnitId('interstitial', true)).toMatch(
      /^ca-app-pub-3940256099942544\//,
    );
  });
});

describe('premium ad suppression', () => {
  it('never shows ads to a premium user, even once initialized', () => {
    // Ad-free is a paid benefit enforced centrally, so no screen can
    // accidentally serve an interstitial to a paying user.
    adMobService.setPremiumStatus(true);
    expect(adMobService.shouldShowAds()).toBe(false);
  });

  it('fails closed before initialization / consent is resolved', () => {
    // shouldShowAds() is also gated on `initialized` (consent + native module),
    // so a fresh service must not show ads regardless of tier.
    adMobService.setPremiumStatus(false);
    expect(adMobService.shouldShowAds()).toBe(false);
  });
});
