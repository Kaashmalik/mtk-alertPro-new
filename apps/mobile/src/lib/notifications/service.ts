import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase/client';
import type { Alert } from '@/types';

/**
 * Android notification channel id.
 *
 * expo-notifications on SDK 52 (0.32.x) does not expose a per-notification
 * `channelId`, so every notification is delivered on the `default` channel.
 * It must therefore be created with MAX importance: on Android 8+ a security
 * alert posted to a low-importance channel is effectively invisible in the
 * shade, which is the single most common cause of "the app never notifies me".
 *
 * Urgency is instead expressed per-notification via `priority` and `vibrate`.
 */
export const ALERTS_CHANNEL_ID = 'default';

/**
 * Channel id used by REMOTE push notifications (the `push-on-alert` Supabase
 * edge function sends `channelId: 'alerts-critical'`). It must exist on the
 * device or Android drops the push, so it is created alongside the default
 * channel below. This is what makes away-from-home alerts actually arrive.
 */
export const CRITICAL_CHANNEL_ID = 'alerts-critical';

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Create the Android notification channels.
 *
 * This MUST be called before scheduling any notification. On Android 8+ an
 * alert posted to a channel that does not exist is silently dropped, and the
 * default channel has low importance, so security alerts would be invisible in
 * the shade. This used to live inside registerForPushNotifications(), which
 * nothing called, so no alert was ever visible.
 *
 * Idempotent: safe to call on every launch.
 */
export async function ensureNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  try {
    await Notifications.setNotificationChannelAsync(ALERTS_CHANNEL_ID, {
      name: 'Security Alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#EF4444',
      sound: 'default',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });

    // Remote push channel. The server/edge function targets this channel id,
    // so without it an away-from-home intruder push is silently dropped on
    // Android 8+.
    await Notifications.setNotificationChannelAsync(CRITICAL_CHANNEL_ID, {
      name: 'Critical Intruder Alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 400, 200, 400],
      lightColor: '#EF4444',
      sound: 'default',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: true,
    });
  } catch (error) {
    console.error('[Notifications] Failed to create channel:', error);
  }
}

/**
 * Ensure the app may post notifications.
 *
 * On Android 13 (API 33) POST_NOTIFICATIONS is a runtime permission. Without
 * it every scheduleNotificationAsync call is a no-op, so a security app
 * silently delivers nothing.
 *
 * @returns true when notifications may be posted.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!Device.isDevice) {
    console.log('Notifications require a physical device');
    return false;
  }

  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === 'granted') return true;

    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  } catch (error) {
    console.error('[Notifications] Permission request failed:', error);
    return false;
  }
}

export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    console.log('Push notifications require a physical device');
    return null;
  }

  // Channels first, then permission, then the token.
  await ensureNotificationChannels();

  if (!(await ensureNotificationPermission())) {
    console.log('Failed to get push notification permissions');
    return null;
  }

  const tokenData = await Notifications.getExpoPushTokenAsync({
    projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID,
  });

  return tokenData.data;
}

export async function savePushToken(userId: string, token: string) {
  const { error } = await supabase
    .from('profiles')
    .update({ fcm_token: token })
    .eq('id', userId);

  if (error) {
    console.error('Failed to save push token:', error);
  }
}

/**
 * Register for push notifications and persist the Expo token to the user's
 * profile, so the `push-on-alert` edge function can reach this device while the
 * app is closed. Safe to call on every authenticated launch ??? Expo returns a
 * stable token and the write is an idempotent upsert of a single column.
 *
 * @returns the Expo push token, or null when unavailable (simulator, denied
 *          permission, no network).
 */
export async function registerAndSavePushToken(userId: string): Promise<string | null> {
  try {
    const token = await registerForPushNotifications();
    if (token) {
      await savePushToken(userId, token);
      console.log('[Notifications] Push token registered for user');
    }
    return token;
  } catch (error) {
    console.error('[Notifications] registerAndSavePushToken failed:', error);
    return null;
  }
}

export async function sendLocalNotification(alert: Alert, cameraName: string): Promise<void>;
export async function sendLocalNotification(options: { title: string; body: string; data?: Record<string, unknown> }): Promise<void>;
export async function sendLocalNotification(
  alertOrOptions: Alert | { title: string; body: string; data?: Record<string, unknown> },
  cameraName?: string
): Promise<void> {
  // Handle simple notification object
  if ('title' in alertOrOptions && 'body' in alertOrOptions) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: alertOrOptions.title,
        body: alertOrOptions.body,
        data: alertOrOptions.data || {},
        sound: 'default',
        badge: 1,
        priority: Notifications.AndroidNotificationPriority.HIGH,
      },
      trigger: null,
    });
    return;
  }

  // Handle Alert object with cameraName
  const alert = alertOrOptions as Alert;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `🚨 ${alert.type.charAt(0).toUpperCase() + alert.type.slice(1)} Detected`,
      body: `${cameraName} detected a ${alert.type}`,
      data: { alertId: alert.id, cameraId: alert.cameraId },
      sound: 'default',
      badge: 1,
      priority: Notifications.AndroidNotificationPriority.HIGH,
      color: '#EF4444',
    },
    trigger: null, // Send immediately
  });
}

/**
 * Post the manual emergency alert at maximum urgency.
 */
export async function sendEmergencyNotification(
  message: string,
  cameraName?: string
): Promise<void> {
  const body = cameraName ? `${message} — triggered from ${cameraName}` : message;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: '🆘 EMERGENCY SOS',
      body,
      data: { type: 'emergency' },
      sound: 'default',
      badge: 1,
      priority: Notifications.AndroidNotificationPriority.MAX,
      // A distinct, harder vibration so an emergency is distinguishable by
      // feel even with the screen off.
      vibrate: [0, 500, 200, 500, 200, 500],
      color: '#DC2626',
    },
    trigger: null,
  });
}

export function addNotificationReceivedListener(
  callback: (notification: Notifications.Notification) => void
) {
  return Notifications.addNotificationReceivedListener(callback);
}

export function addNotificationResponseListener(
  callback: (response: Notifications.NotificationResponse) => void
) {
  return Notifications.addNotificationResponseReceivedListener(callback);
}

export async function clearBadgeCount() {
  await Notifications.setBadgeCountAsync(0);
}

export async function cancelAllNotifications() {
  await Notifications.cancelAllScheduledNotificationsAsync();
}
