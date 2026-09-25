/**
 * RevenueCat / Play Billing bridge (optional beside WhatsApp pay for PK).
 * When EXPO_PUBLIC_REVENUECAT_API_KEY is set, initialize Purchases.
 */

const API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY;

export async function initRevenueCat(appUserId?: string): Promise<boolean> {
  if (!API_KEY || API_KEY.includes('your-revenuecat')) {
    console.log('[RevenueCat] Skipped — API key not configured (WhatsApp pay remains available)');
    return false;
  }

  try {
    // Dynamic require so Expo Go without the native module still loads
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Purchases = require('react-native-purchases').default;
    Purchases.configure({ apiKey: API_KEY, appUserID: appUserId });
    return true;
  } catch (e) {
    console.warn('[RevenueCat] Native module unavailable:', e);
    return false;
  }
}

export async function getOfferings(): Promise<unknown | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Purchases = require('react-native-purchases').default;
    return await Purchases.getOfferings();
  } catch {
    return null;
  }
}
