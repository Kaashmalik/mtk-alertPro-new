/**
 * Emergency (SOS) Service
 *
 * Backs the manual emergency button. When triggered it:
 *   1. Loops the SOS alarm at full volume until explicitly resolved
 *   2. Vibrates continuously with a distinct distress pattern
 *   3. Posts a high-urgency notification on its own channel
 *   4. Persists an `alerts` row (type='emergency') and offers to SMS the
 *      user's trusted contacts, so an SOS leaves a server-side trace and
 *      reaches other people
 *
 * An emergency stays active until the user resolves it. That is deliberate: a
 * security app must not silently time out a distress event.
 *
 * @module lib/emergency/emergencyService
 */

import { alarmService } from '@/lib/audio/alarmService';
import { sendEmergencyNotification } from '@/lib/notifications/service';
import { formatTimeOfDay } from '@/lib/utils/date';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  AppState,
  type AppStateStatus,
  Linking,
  Vibration,
} from 'react-native';

export type EmergencyReason = 'manual' | 'panic' | 'test';
export type EmergencyStatus = 'idle' | 'active' | 'resolved';

/** Row id of the persisted `alerts` row for the in-flight emergency, if any. */
let persistedAlertId: string | null = null;

export interface EmergencyEvent {
  id: string;
  reason: EmergencyReason;
  note?: string;
  cameraName?: string;
  startedAt: Date;
  resolvedAt?: Date;
}

export interface EmergencyState {
  status: EmergencyStatus;
  event: EmergencyEvent | null;
  /** Monotonic token so a stale async continuation cannot re-arm the alarm. */
  token: number;
}

type Listener = (state: EmergencyState) => void;

const state: EmergencyState = {
  status: 'idle',
  event: null,
  token: 0,
};

const listeners = new Set<Listener>();
const history: EmergencyEvent[] = [];

/** Vibration loop interval while an emergency is active. */
const VIBRATION_INTERVAL_MS = 1500;
const VIBRATION_PATTERN = [0, 500, 200, 500, 200, 500];

let vibrationTimer: ReturnType<typeof setInterval> | null = null;
let appStateSub: { remove: () => void } | null = null;

function emit(): void {
  const snapshot: EmergencyState = {
    ...state,
    event: state.event ? { ...state.event } : null,
  };
  for (const listener of listeners) listener(snapshot);
}

function stopVibrationLoop(): void {
  if (vibrationTimer) {
    clearInterval(vibrationTimer);
    vibrationTimer = null;
  }
  Vibration.cancel();
}

function startVibrationLoop(): void {
  stopVibrationLoop();
  Vibration.vibrate(VIBRATION_PATTERN);
  vibrationTimer = setInterval(() => {
    Vibration.vibrate(VIBRATION_PATTERN);
  }, VIBRATION_INTERVAL_MS);
}

/**
 * Arm the loop. expo-av can be suspended by the OS when the app backgrounds,
 * so the audio mode is re-asserted on every foreground transition while an
 * emergency is active.
 */
function watchAppState(): void {
  if (appStateSub) return;

  appStateSub = AppState.addEventListener('change', (next: AppStateStatus) => {
    if (next === 'active' && state.status === 'active') {
      void alarmService.playAlarm('sos', {
        volume: 1.0,
        repeat: true,
        repeatCount: Number.POSITIVE_INFINITY,
        vibrate: false, // handled by the vibration loop
      });
    }
  });
}

function unwatchAppState(): void {
  appStateSub?.remove();
  appStateSub = null;
}

/**
 * Persist the SOS as an `alerts` row so it appears in history and can sync to
 * other devices. camera_id is NULL for account-level SOS.
 * Fire-and-forget: a server failure must not interrupt the alarm.
 */
async function persistEmergencyAlert(
  event: EmergencyEvent,
): Promise<string | null> {
  try {
    const { supabase } = await import('@/lib/supabase/client');
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      console.warn('[Emergency] No auth user; skipping persist');
      return null;
    }
    const { data, error } = await supabase
      .from('alerts')
      .insert({
        user_id: user.id,
        camera_id: null,
        type: 'emergency',
        confidence: 1,
        emergency_reason: event.reason,
        metadata: {
          note: event.note ?? null,
          cameraName: event.cameraName ?? null,
        },
        is_read: true,
      })
      .select('id')
      .single();
    if (error) throw error;
    return (data as { id: string }).id;
  } catch (error) {
    console.error('[Emergency] Failed to persist alert:', error);
    return null;
  }
}

/** Mark the persisted SOS row resolved. */
async function finalizePersistedAlert(): Promise<void> {
  if (!persistedAlertId) return;
  const id = persistedAlertId;
  persistedAlertId = null;
  try {
    const { supabase } = await import('@/lib/supabase/client');
    await supabase
      .from('alerts')
      .update({ resolved_at: new Date().toISOString() })
      .eq('id', id);
  } catch (error) {
    console.error('[Emergency] Failed to finalize alert:', error);
  }
}

/**
 * Notify the user's trusted contacts of an active SOS.
 *
 * Opens the system SMS composer pre-filled with the alert. The user confirms
 * send, which keeps us on the right side of the "no silent messaging" rule and
 * works even when the phone has no data connection. No-ops when no contacts
 * are configured.
 */
async function notifyTrustedContacts(event: EmergencyEvent): Promise<void> {
  try {
    const { supabase } = await import('@/lib/supabase/client');
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('emergency_contacts')
      .select('name, phone')
      .eq('user_id', user.id);
    if (error) throw error;

    const contacts = (data ?? []) as { name: string; phone: string }[];
    if (contacts.length === 0) {
      console.log('[Emergency] No trusted contacts configured');
      return;
    }

    const when = formatTimeOfDay(event.startedAt);
    const where = event.cameraName ? ` at ${event.cameraName}` : '';
    const body = `URGENT: An SOS was triggered on MTK AlertPro${where} at ${when}.${event.note ? ` Note: ${event.note}` : ''}`;

    const numbers = contacts
      .map((c) => c.phone.replace(/[^\d+]/g, ''))
      .join(',');
    const url = `sms:${numbers}?&body=${encodeURIComponent(body)}`;
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
    } else {
      console.warn('[Emergency] Cannot open SMS composer');
    }
  } catch (error) {
    console.error('[Emergency] Failed to notify contacts:', error);
  }
}

/**
 * Activate the emergency alarm.
 *
 * @param reason - What triggered the emergency
 * @param options.note - Optional free-text context ("front door", "armed at night")
 * @param options.cameraName - Camera the user was viewing, if any
 */
export async function triggerEmergency(
  reason: EmergencyReason = 'manual',
  options: { note?: string; cameraName?: string } = {},
): Promise<void> {
  // Claim the token before any await so a rapid resolve() cannot be undone by
  // a slow playAlarm() resuming afterwards.
  const token = ++state.token;

  state.status = 'active';
  state.event = {
    id: `sos-${Date.now()}`,
    reason,
    note: options.note,
    cameraName: options.cameraName,
    startedAt: new Date(),
  };
  emit();

  const notifications = useSettingsStore.getState().notifications;

  startVibrationLoop();
  watchAppState();

  try {
    await alarmService.playAlarm('sos', {
      volume: 1.0,
      repeat: true,
      // An emergency repeats until resolved, not a fixed count.
      repeatCount: Number.POSITIVE_INFINITY,
      vibrate: false, // the interval loop handles vibration
    });
  } catch (error) {
    console.error('[Emergency] Failed to start alarm audio:', error);
  }

  if (token !== state.token) return; // resolved while we were starting

  if (notifications.enabled) {
    try {
      await sendEmergencyNotification(
        options.note || 'Emergency button pressed',
        options.cameraName,
      );
    } catch (error) {
      console.error(
        '[Emergency] Failed to post emergency notification:',
        error,
      );
    }
  }

  if (token !== state.token) return; // resolved while we were starting

  // Persist + notify. Both are fire-and-forget and must never delay the alarm.
  void persistEmergencyAlert(state.event).then((id) => {
    if (id && token === state.token) persistedAlertId = id;
  });
  void notifyTrustedContacts(state.event);
}

/**
 * Stop the emergency alarm and mark the event resolved.
 */
export async function resolveEmergency(): Promise<void> {
  state.token++;
  state.status = 'resolved';
  if (state.event) {
    state.event.resolvedAt = new Date();
    history.unshift(state.event);
    // Bound the in-memory log; persisted history lives in the alerts table.
    if (history.length > 50) history.length = 50;
  }
  emit();

  stopVibrationLoop();
  unwatchAppState();
  await alarmService.stopAlarm();
  void finalizePersistedAlert();

  state.event = null;
  emit();
}

export function isEmergencyActive(): boolean {
  return state.status === 'active';
}

export function getEmergencyState(): EmergencyState {
  return { ...state, event: state.event ? { ...state.event } : null };
}

export function getEmergencyHistory(): EmergencyEvent[] {
  return [...history];
}

export function subscribeToEmergency(listener: Listener): () => void {
  listeners.add(listener);
  listener(getEmergencyState());
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Release timers and native resources. Call on app teardown.
 */
export function disposeEmergencyService(): void {
  state.token++;
  stopVibrationLoop();
  unwatchAppState();
  listeners.clear();
}
