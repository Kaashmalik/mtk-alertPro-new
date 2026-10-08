import { adMobService } from '@/lib/ads/adMobService';
import type React from 'react';
import { StyleSheet, View } from 'react-native';

import {
  RNBannerAd as BannerAd,
  RNBannerAdSize as BannerAdSize,
} from '../../lib/ads/admob-proxy';

interface BannerAdProps {
  size?: string;
  style?: any;
}

/**
 * Banner Ad Component
 * Displays a banner advertisement at bottom of screen
 */
export const AdBanner: React.FC<BannerAdProps> = ({ size, style }) => {
  // Guard first, and never touch the proxy exports before this point.
  // admob-proxy.native.ts falls back to `null` when the native module is
  // absent (Expo Go, or a build without the AdMob native lib), so reading
  // BannerAdSize.ANCHORED_ADAPTIVE_BANNER as a *default parameter* -- which is
  // evaluated before the body runs -- threw a TypeError and took down the
  // whole screen via the root ErrorBoundary.
  if (!adMobService.isNativeAvailable() || !adMobService.shouldShowAds()) {
    return null;
  }

  // Still guard: the module can be present while these named exports are not.
  if (!BannerAd || !BannerAdSize) {
    console.warn('[AdBanner] Native module present but banner exports missing');
    return null;
  }

  const resolvedSize = size ?? BannerAdSize.ANCHORED_ADAPTIVE_BANNER;

  return (
    <View style={[styles.container, style]}>
      <BannerAd
        unitId={adMobService.getAdUnitId('banner')}
        size={resolvedSize}
        requestOptions={adMobService.getRequestOptions()}
        onAdLoaded={() => {
          console.log('[AdBanner] Ad loaded successfully');
        }}
        onAdFailedToLoad={(error: Error) => {
          console.error('[AdBanner] Failed to load ad:', error.message);
        }}
        onAdOpened={() => {
          console.log('[AdBanner] Ad opened');
        }}
        onAdClosed={() => {
          console.log('[AdBanner] Ad closed');
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
});
