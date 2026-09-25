let admob: any = {};
try {
    admob = require('react-native-google-mobile-ads');
} catch (e) {
    console.log('[AdMobProxy] Native module not available (e.g. Expo Go)');
}

export const RNBannerAd = admob.BannerAd || null;
export const RNBannerAdSize = admob.BannerAdSize || null;
export const RNInterstitialAd = admob.InterstitialAd || null;
export const RNAdEventType = admob.AdEventType || null;
export const RNTestIds = admob.TestIds || null;
export const RNAdsConsent = admob.AdsConsent || null;
export const RNAdsConsentDebugGeography = admob.AdsConsentDebugGeography || null;
export const RNMaxAdContentRating = admob.MaxAdContentRating || null;
export const RNMobileAds = admob.default || null;
