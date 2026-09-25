import { create } from 'zustand';
import { Vibration } from 'react-native';
import { supabase } from '@/lib/supabase/client';
import { alarmService } from '@/lib/audio/alarmService';
import { useSettingsStore } from './settingsStore';
import { useCameraStore } from './cameraStore';
import { wasLocalAlertRecent } from '@/features/detection/alertDedup';
import type { Alert } from '@/types';

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
      const { data, error } = await supabase
        .from('alerts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      const alerts: Alert[] = (data || []).map((a) => ({
        id: a.id,
        cameraId: a.camera_id,
        userId: a.user_id,
        type: a.type as Alert['type'],
        confidence: a.confidence,
        snapshotUrl: a.snapshot_url || undefined,
        videoClipUrl: a.video_clip_url || undefined,
        metadata: a.metadata || {},
        isRead: a.is_read,
        createdAt: new Date(a.created_at),
      }));

      set({
        alerts,
        unreadCount: alerts.filter((a) => !a.isRead).length,
        error: null,
      });
    } catch (error) {
      console.error('Failed to fetch alerts:', error);
      set({ error: error instanceof Error ? error.message : 'Failed to fetch alerts' });
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
      alerts: [newAlert, ...state.alerts],
      unreadCount: state.unreadCount + 1,
    }));

    try {
      if (newAlertData.skipPersist) {
        return;
      }
      const { data: { user } } = await supabase.auth.getUser();
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
        a.id === id ? { ...a, isRead: true } : a
      ),
      unreadCount: Math.max(0, get().unreadCount - 1),
    });
  },

  markAllAsRead: async () => {
    const { data: { user } } = await supabase.auth.getUser();
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
      unreadCount: alert && !alert.isRead
        ? Math.max(0, get().unreadCount - 1)
        : get().unreadCount,
    });
  },

  subscribeToAlerts: () => {
    const channel = supabase
      .channel('alerts-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'alerts' },
        async (payload) => {
          const newAlert: Alert = {
            id: payload.new.id,
            cameraId: payload.new.camera_id,
            userId: payload.new.user_id,
            type: payload.new.type as Alert['type'],
            confidence: payload.new.confidence,
            snapshotUrl: payload.new.snapshot_url || undefined,
            videoClipUrl: payload.new.video_clip_url || undefined,
            metadata: payload.new.metadata || {},
            isRead: payload.new.is_read,
            createdAt: new Date(payload.new.created_at),
          };

          const localRecent = wasLocalAlertRecent(newAlert.cameraId, newAlert.type);

          if (!localRecent) {
            set({
              alerts: [newAlert, ...get().alerts.filter((a) => a.id !== newAlert.id)],
              unreadCount: get().unreadCount + 1,
            });
          } else {
            // Replace optimistic local row with server id when possible
            set({
              alerts: get().alerts.map((a) =>
                a.cameraId === newAlert.cameraId &&
                a.type === newAlert.type &&
                Math.abs(a.createdAt.getTime() - newAlert.createdAt.getTime()) < 15000
                  ? { ...newAlert }
                  : a
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
          const camera = cameras.find(c => c.id === newAlert.cameraId);

          const isValidAlertType = newAlert.type === 'person' || newAlert.type === 'vehicle';
          const cameraAllowsAlarm = camera?.detectionSettings?.alarmEnabled ?? true;
          const cameraAllowsNotification = camera?.detectionSettings?.notificationsEnabled ?? true;
          const detectionTypeEnabled =
            (newAlert.type === 'person' && camera?.detectionSettings?.person) ||
            (newAlert.type === 'vehicle' && camera?.detectionSettings?.vehicle);

          if (isValidAlertType && detectionTypeEnabled) {
            if (settings.sound && cameraAllowsAlarm) {
              try {
                await alarmService.playAlarm(settings.alarmSound, {
                  volume: settings.alarmVolume,
                  repeat: settings.repeatAlarm,
                  repeatCount: settings.repeatCount,
                });
              } catch (error) {
                console.error('Failed to play alarm:', error);
              }
            }

            if (settings.vibration && cameraAllowsNotification) {
              Vibration.vibrate([0, 500, 200, 500, 200, 500]);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },

  clearError: () => set({ error: null }),
}));
