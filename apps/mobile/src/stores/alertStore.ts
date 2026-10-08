import { wasLocalAlertRecent } from '@/features/detection/alertDedup';
import { toAlert, toAlerts } from '@/features/detection/alertSanitizer';
import { alarmService } from '@/lib/audio/alarmService';
import { getPlanLimits, isTierActive } from '@/lib/subscription/planLimits';
import { supabase } from '@/lib/supabase/client';
import type { Alert } from '@/types';
import { Vibration } from 'react-native';
import { create } from 'zustand';
import { useCameraStore } from './cameraStore';
import { useSettingsStore } from './settingsStore';
import { useSubscriptionStore } from './subscriptionStore';

/**
 * Exactly one realtime channel for the whole app, shared by every caller.
 *
 * Supabase identifies a channel by its topic name, so two channels named
 * 'alerts-realtime' collide and the second `postgres_changes` registration is
 * rejected ("cannot add postgres_changes callback for realtime ..."). That is
 * not hypothetical: the root layout subscribed on mount *and* again on every
 * app foreground while discarding the unsubscribe function, and the Alerts tab
 * subscribed a third time -- so after a couple of foregrounds the subscription
 * errored and surfaced as a full-screen "Something went wrong".
 *
 * Callers now take a reference instead of owning a channel. Only the final
 * release tears it down.
 */
type AlertsChannel = ReturnType<typeof supabase.channel>;

let activeAlertsChannel: AlertsChannel | null = null;
let alertsSubscribers = 0;

const CHANNEL_TOPIC = 'alerts-realtime';

/**
 * How many alerts the current plan keeps.
 *
 * `maxAlertHistory` was previously only counted for the usage meter. The fetch
 * used a hardcoded limit of 100 and nothing ever deleted old rows, so a free
 * account (entitled to 7) accumulated an unbounded alerts table. Read through
 * isTierActive() so a lapsed paid plan drops back to the free allowance.
 */
function alertRetentionLimit(): number {
  const { currentTier, expiresAt } = useSubscriptionStore.getState();
  const effective = isTierActive(currentTier, expiresAt) ? currentTier : 'free';
  return getPlanLimits(effective).maxAlertHistory;
}

/** Keep the newest `limit` alerts (the list is ordered newest-first). */
function applyRetention(alerts: Alert[], limit: number): Alert[] {
  if (!Number.isFinite(limit) || alerts.length <= limit) return alerts;
  return alerts.slice(0, limit);
}

/**
 * Delete the user's alerts beyond the plan's retention limit, oldest first.
 *
 * Implemented as "collect the ids we're about to drop, then delete them" rather
 * than a server-side window function: it works through PostgREST without a
 * custom RPC, and the id set is bounded by how far over the cap we are (usually
 * one row per new alert). Best-effort — a failure here must never block the
 * alert that triggered it, so errors are swallowed after logging.
 */
async function trimOldAlertRows(userId: string): Promise<void> {
  const limit = alertRetentionLimit();
  if (!Number.isFinite(limit)) return; // unlimited plan

  try {
    const { data: overflow, error: selectError } = await supabase
      .from('alerts')
      .select('id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(limit, limit + 99);

    if (selectError) {
      console.warn(
        '[AlertStore] retention select failed:',
        selectError.message,
      );
      return;
    }

    const ids = (overflow ?? []).map((row) => row.id as string);
    if (ids.length === 0) return;

    const { error: deleteError } = await supabase
      .from('alerts')
      .delete()
      .eq('user_id', userId)
      .in('id', ids);

    if (deleteError) {
      console.warn(
        '[AlertStore] retention delete failed:',
        deleteError.message,
      );
    }
  } catch (error) {
    console.warn('[AlertStore] retention trim failed:', error);
  }
}

interface AlertState {
  alerts: Alert[];
  unreadCount: number;
  isLoading: boolean;
  error: string | null;

  fetchAlerts: () => Promise<void>;
  addAlert: (alert: {
    cameraId: string;
    cameraName?: string;
    type: Alert['type'];
    confidence: number;
    timestamp?: Date;
    isRead?: boolean;
    snapshotUrl?: string;
    videoClipUrl?: string;
    /** When true, only update local UI (manager already wrote DB) */
    skipPersist?: boolean;
  }) => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteAlert: (id: string) => Promise<void>;
  subscribeToAlerts: () => () => void;
  clearError: () => void;
}

export const useAlertStore = create<AlertState>((set, get) => ({
  alerts: [],
  unreadCount: 0,
  isLoading: false,
  error: null,

  fetchAlerts: async () => {
    set({ isLoading: true, error: null });
    try {
      const retention = alertRetentionLimit();
      // Only ask the server for what the plan can show.
      const fetchLimit = Number.isFinite(retention) ? retention : 100;

      const { data, error } = await supabase
        .from('alerts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(fetchLimit);

      if (error) throw error;

      // Rows are sanitised at this boundary so a schema mismatch can never
      // propagate into the list and crash the screen.
      const alerts = applyRetention(toAlerts(data), retention);

      set({
        alerts,
        unreadCount: alerts.filter((a) => !a.isRead).length,
        error: null,
      });
    } catch (error) {
      console.error('Failed to fetch alerts:', error);
      set({
        error:
          error instanceof Error ? error.message : 'Failed to fetch alerts',
      });
    } finally {
      set({ isLoading: false });
    }
  },

  addAlert: async (newAlertData) => {
    const alertId = `alert_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newAlert: Alert = {
      id: alertId,
      cameraId: newAlertData.cameraId,
      userId: 'current-user',
      type: newAlertData.type,
      confidence: newAlertData.confidence,
      snapshotUrl: newAlertData.snapshotUrl,
      videoClipUrl: newAlertData.videoClipUrl,
      metadata: {},
      isRead: false,
      createdAt: newAlertData.timestamp || new Date(),
    };

    set((state) => ({
      alerts: applyRetention(
        [newAlert, ...state.alerts],
        alertRetentionLimit(),
      ),
      unreadCount: state.unreadCount + 1,
    }));

    try {
      if (newAlertData.skipPersist) {
        return;
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        newAlert.userId = user.id;
        await supabase.from('alerts').insert({
          camera_id: newAlertData.cameraId,
          user_id: user.id,
          type: newAlertData.type,
          confidence: newAlertData.confidence,
          snapshot_url: newAlertData.snapshotUrl,
          video_clip_url: newAlertData.videoClipUrl,
          metadata: {},
          is_read: false,
        });

        // Retention has to be enforced on the rows too, not just the UI: the
        // alerts table is the only thing bounding table growth, and a free tier
        // is entitled to `maxAlertHistory` (7) rows, not unlimited.
        await trimOldAlertRows(user.id);
      }
    } catch (dbErr) {
      console.warn('[AlertStore] Supabase alert sync notice:', dbErr);
    }
  },

  markAsRead: async (id) => {
    const { error } = await supabase
      .from('alerts')
      .update({ is_read: true })
      .eq('id', id);

    if (error) throw error;

    set({
      alerts: get().alerts.map((a) =>
        a.id === id ? { ...a, isRead: true } : a,
      ),
      unreadCount: Math.max(0, get().unreadCount - 1),
    });
  },

  markAllAsRead: async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('alerts')
      .update({ is_read: true })
      .eq('user_id', user.id)
      .eq('is_read', false);

    if (error) throw error;

    set({
      alerts: get().alerts.map((a) => ({ ...a, isRead: true })),
      unreadCount: 0,
    });
  },

  deleteAlert: async (id) => {
    const { error } = await supabase.from('alerts').delete().eq('id', id);
    if (error) throw error;

    const alert = get().alerts.find((a) => a.id === id);
    set({
      alerts: get().alerts.filter((a) => a.id !== id),
      unreadCount:
        alert && !alert.isRead
          ? Math.max(0, get().unreadCount - 1)
          : get().unreadCount,
    });
  },

  subscribeToAlerts: () => {
    // Reference-counted: hand out a release function, never a second channel.
    alertsSubscribers += 1;
    let released = false;

    const release = () => {
      if (released) return;
      released = true;
      alertsSubscribers -= 1;

      if (alertsSubscribers > 0) return;

      const channel = activeAlertsChannel;
      activeAlertsChannel = null;
      if (!channel) return;
      try {
        void supabase.removeChannel(channel);
      } catch (error) {
        console.warn('[AlertStore] failed to remove realtime channel:', error);
      }
    };

    if (activeAlertsChannel) {
      // Already live -- another component holds a reference.
      return release;
    }

    try {
      const channel = supabase
        .channel(CHANNEL_TOPIC)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'alerts' },
          async (payload) => {
            const newAlert = toAlert(payload.new as Record<string, unknown>);
            if (!newAlert) return;

            const localRecent = wasLocalAlertRecent(
              newAlert.cameraId,
              newAlert.type,
            );

            if (!localRecent) {
              set({
                alerts: applyRetention(
                  [
                    newAlert,
                    ...get().alerts.filter((a) => a.id !== newAlert.id),
                  ],
                  alertRetentionLimit(),
                ),
                unreadCount: get().unreadCount + 1,
              });
            } else {
              // Replace optimistic local row with server id when possible
              set({
                alerts: get().alerts.map((a) =>
                  a.cameraId === newAlert.cameraId &&
                  a.type === newAlert.type &&
                  Math.abs(
                    a.createdAt.getTime() - newAlert.createdAt.getTime(),
                  ) < 15000
                    ? { ...newAlert }
                    : a,
                ),
              });
              return;
            }

            // Skip if system disarmed
            if (useSettingsStore.getState().detection.armed === false) {
              return;
            }

            // Get settings and camera info
            const settings = useSettingsStore.getState().notifications;
            const cameras = useCameraStore.getState().cameras;
            const camera = cameras.find((c) => c.id === newAlert.cameraId);

            const isValidAlertType =
              newAlert.type === 'person' || newAlert.type === 'vehicle';
            const cameraAllowsAlarm =
              camera?.detectionSettings?.alarmEnabled ?? true;
            const cameraAllowsNotification =
              camera?.detectionSettings?.notificationsEnabled ?? true;

            // If the camera is not in the local store yet (cold start, or the
            // camera was deleted), fall back to ALLOWING the alert. Defaulting to
            // false here silently dropped real person/vehicle alerts.
            const detectionTypeEnabled = camera
              ? newAlert.type === 'person'
                ? !!camera.detectionSettings?.person
                : !!camera.detectionSettings?.vehicle
              : true;

            if (isValidAlertType && detectionTypeEnabled) {
              if (settings.sound && cameraAllowsAlarm) {
                try {
                  await alarmService.playAlarm(settings.alarmSound, {
                    volume: settings.alarmVolume,
                    repeat: settings.repeatAlarm,
                    repeatCount: settings.repeatCount,
                    // alarmService no longer vibrates unconditionally; pass the
                    // user's preference through so the toggle actually works.
                    vibrate: false,
                  });
                } catch (error) {
                  console.error('Failed to play alarm:', error);
                }
              }

              if (settings.vibration && cameraAllowsNotification) {
                Vibration.vibrate([0, 500, 200, 500, 200, 500]);
              }
            }
          },
        )
        .subscribe((status) => {
          // A postgres_changes subscription can fail at runtime (RLS rejects the
          // realtime filter, or the table is not in the supabase_realtime
          // publication). Without this callback the SDK logs an unhandled
          // "postgres_changes" error and the app keeps a dead subscription that
          // silently never delivers again. Surface it instead.
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn(`[AlertStore] realtime subscribe ${status}`);
            set({
              error:
                'Live alerts are reconnecting. Pull down to refresh in the meantime.',
            });
          } else if (status === 'SUBSCRIBED') {
            console.log('[AlertStore] realtime alerts subscribed');
            if (get().error?.includes('reconnecting')) {
              set({ error: null });
            }
          }
        });

      activeAlertsChannel = channel;
      return release;
    } catch (error) {
      // Live alerts are an enhancement on top of fetchAlerts() + pull to
      // refresh. A realtime failure must never propagate: this runs inside a
      // useEffect, so a throw here unmounts the tree and the root ErrorBoundary
      // replaces the whole screen with "Something went wrong".
      console.warn('[AlertStore] realtime subscribe failed:', error);
      // Roll the reference back so the count stays accurate.
      alertsSubscribers -= 1;
      return () => {};
    }
  },

  clearError: () => set({ error: null }),
}));
