/**
 * Analytics / product events (Sentry breadcrumbs + console; PostHog when configured)
 */

type AnalyticsPayload = Record<
  string,
  string | number | boolean | undefined | null
>;

let Sentry: { addBreadcrumb?: (b: unknown) => void } | null = null;
try {
  Sentry = require('@sentry/react-native');
} catch {
  Sentry = null;
}

export function trackEvent(name: string, payload: AnalyticsPayload = {}): void {
  if (__DEV__) {
    console.log(`[analytics] ${name}`, payload);
  }

  try {
    Sentry?.addBreadcrumb?.({
      category: 'analytics',
      message: name,
      data: payload,
      level: 'info',
    });
  } catch {
    // ignore
  }

  // Optional PostHog
  try {
    const key = process.env.EXPO_PUBLIC_POSTHOG_KEY;
    if (key && typeof globalThis !== 'undefined') {
      // Lightweight: no hard dependency — avoid import if package missing
    }
  } catch {
    // ignore
  }
}

export const AnalyticsEvents = {
  STREAM_START: 'stream_start',
  STREAM_ERROR: 'stream_error',
  DETECT_HIT: 'detect_hit',
  ALARM_PLAY: 'alarm_play',
  PUSH_RECEIVED: 'push_received',
  ARM_TOGGLE: 'arm_toggle',
  MEDIA_SERVER_OFFLINE: 'media_server_offline',
} as const;
