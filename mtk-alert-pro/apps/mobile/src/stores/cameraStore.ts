/**
 * Camera Store
 * Manages camera state with Zustand
 * 
 * @module stores/cameraStore
 */

import { create } from 'zustand';
import { supabase, isSupabaseConfigured } from '@/lib/supabase/client';
import { encryptPassword, decryptPassword, isEncrypted } from '@/lib/crypto';
import {
  testCameraConnection,
  createHealthMonitor,
  type ConnectionTestResult,
  type CameraHealth
} from '@/lib/camera/connectionService';
import { sanitizeRtspUrl } from '@/lib/camera/rtspHelper';
import {
  saveCamerasCache,
  loadCamerasCache,
  saveHealthCache,
  loadHealthCache,
  loadOfflineQueue,
  saveOfflineQueue,
  clearCameraCache,
} from '@/lib/camera/cameraCache';
import {
  withRetry,
  logError,
  createAppError,
  isAppError,
  type AppError,
} from '@/lib/utils/errorHandler';
import { reviewManager } from '@/lib/reviews/reviewManager';
import type { Camera, DetectionSettings } from '@/types';

/**
 * Camera store state interface
 */
interface CameraState {
  // State
  cameras: Camera[];
  isLoading: boolean;
  /** True once cold-start cache hydration has finished (even if empty) */
  isHydrated: boolean;
  error: string | null;
  selectedCamera: Camera | null;
  connectionTests: Record<string, ConnectionTestResult>;
  cameraHealth: Record<string, CameraHealth>;
  isTestingConnection: boolean;
  isOffline: boolean;
  offlineQueue: QueuedOperation[];
  /** User-visible message when queued ops keep failing (null = healthy) */
  offlineQueueError: string | null;
  healthMonitorCleanup: (() => void) | null;

  // Actions
  /** Load cameras + health + offline queue from AsyncStorage (stale-while-revalidate step 1) */
  hydrateFromCache: () => Promise<void>;
  fetchCameras: () => Promise<void>;
  addCamera: (camera: Omit<Camera, 'id' | 'userId' | 'createdAt' | 'updatedAt'>) => Promise<Camera>;
  updateCamera: (id: string, updates: Partial<Camera>) => Promise<void>;
  deleteCamera: (id: string) => Promise<void>;
  selectCamera: (camera: Camera | null) => void;
  testConnection: (rtspUrl: string) => Promise<ConnectionTestResult>;
  startHealthMonitoring: () => () => void;
  stopHealthMonitoring: () => void;
  getCameraHealth: (cameraId: string) => CameraHealth | undefined;
  clearError: () => void;
  reset: () => void;
  queueOfflineOperation: (operation: QueuedOperation) => Promise<void>;
  processOfflineQueue: () => Promise<void>;
  /** Clear AsyncStorage cache (sign-out / hard reset) */
  clearCache: () => Promise<void>;
}

/**
 * Queued offline operation
 */
interface QueuedOperation {
  type: 'add' | 'update' | 'delete';
  id?: string;
  data?: any;
  /** Set by queueOfflineOperation when the write is first queued */
  timestamp?: number;
  /** Retry count — incremented each time a replay fails */
  attempts?: number;
  /** Last failure message, surfaced once retries are exhausted */
  lastError?: string;
  /** Earliest timestamp this op may be retried (exponential backoff) */
  nextRetryAt?: number;
}

/**
 * Offline-queue retry policy.
 *
 * Mirrors rtspStreamingService.#scheduleReconnect so the app uses one backoff
 * philosophy for connectivity:
 *   delay = min(base * 2^attempts, cap) ± 20% jitter
 * Ops never get dropped; after `maxAttempts` auto-retry stops and the failure
 * is surfaced via `offlineQueueError` instead of being invisible.
 */
export const OFFLINE_QUEUE_RETRY = {
  baseDelayMs: 2000,
  maxDelayMs: 30000,
  maxAttempts: 6,
} as const;

/** True when a thrown error means loss of connectivity, not an app/DB error */
function isNetworkError(error: unknown): boolean {
  // fetch failures surface as TypeError in React Native (and in node/jest)
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return (
    lower.includes('network') ||
    lower.includes('offline') ||
    lower.includes('fetch') ||
    lower.includes('failed to fetch') ||
    lower.includes('timeout')
  );
}

/**
 * True while offline-queue replays are in flight, so a replay that hits a
 * network error re-queues the SAME mutation instead of duplicating it.
 */
let isReplayingQueue = false;

/** Pending timer for the next automatic backoff retry (cleared in reset()) */
let offlineQueueRetryTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Initial state
 */
const initialState = {
  cameras: [],
  isLoading: false,
  isHydrated: false,
  error: null,
  selectedCamera: null,
  connectionTests: {},
  cameraHealth: {},
  isTestingConnection: false,
  isOffline: false,
  offlineQueue: [],
  /** User-visible message when queued ops exhaust retries (null = healthy) */
  offlineQueueError: null,
  healthMonitorCleanup: null,
};

/**
 * Camera Zustand store
 */
export const useCameraStore = create<CameraState>((set, get) => ({
  ...initialState,

  /**
   * Cold-start hydration (stale-while-revalidate step 1).
   * Paints the last-known camera list + health badges instantly from
   * AsyncStorage so the UI never shows an empty flash before the network.
   * Safe to call multiple times; only fills state that is still empty
   * (or replaces health so badges aren't blank).
   */
  hydrateFromCache: async () => {
    // Parallel reads — cache hits are the fast path
    const [cachedCameras, cachedHealth, cachedQueue] = await Promise.all([
      loadCamerasCache(),
      loadHealthCache(),
      loadOfflineQueue(),
    ]);

    const { cameras, cameraHealth, offlineQueue } = get();

    set({
      // Only seed cameras if we don't already have live data
      cameras: cameras.length === 0 ? cachedCameras : cameras,
      // Merge health so a later hydrate doesn't wipe fresh heartbeat results
      cameraHealth: { ...cachedHealth, ...cameraHealth },
      offlineQueue: offlineQueue.length === 0 ? cachedQueue : offlineQueue,
      isHydrated: true,
      // Show the list as stale/offline until revalidate succeeds
      isOffline: cameras.length === 0 && cachedCameras.length > 0,
    });

    // If we hydrated a non-empty list, start heartbeat right away
    // (fetchCameras will restart it with the authoritative list)
    if (cachedCameras.length > 0 && get().cameras.length > 0) {
      get().startHealthMonitoring();
    }
  },

  /**
   * Fetch all cameras for the current user (revalidate step).
   * Call hydrateFromCache() first on cold start.
   */
  fetchCameras: async () => {
    if (!isSupabaseConfigured) {
      console.warn('[CameraStore] Supabase not configured - using empty cameras list');
      set({ cameras: [], isLoading: false, isHydrated: true });
      return;
    }

    // Only block the UI when we have nothing to show yet
    const hasVisibleData = get().cameras.length > 0;
    set({ isLoading: true, error: null });

    try {
      const { data, error } = await withRetry(
        async () => {
          const result = await supabase
            .from('cameras')
            .select('*')
            .order('created_at', { ascending: false });

          if (result.error) throw result.error;
          return result;
        },
        { maxRetries: 2 }
      );

      if (error) throw error;

      // Rows whose rtsp_url held plaintext credentials — rewrite them clean
      const dirtyRows: { id: string; rtspUrl: string }[] = [];

      const cameras: Camera[] = (data || []).map((c) => {
        // 🔒 Never keep credential-bearing URLs in state. Legacy rows may have
        // plaintext user:pass@ baked into rtsp_url — strip it and remember the
        // row so the DB self-heals below (SQL migration covers bulk cleanup).
        const rtspUrl = sanitizeRtspUrl(c.rtsp_url);
        if (c.rtsp_url && rtspUrl !== c.rtsp_url) {
          dirtyRows.push({ id: c.id, rtspUrl });
        }
        return {
          id: c.id,
          userId: c.user_id,
          name: c.name,
          rtspUrl,
          username: c.username || undefined,
          // Keep password encrypted in memory for security
          password: c.password || undefined,
          isActive: c.is_active ?? true,
          thumbnailUrl: c.thumbnail_url || undefined,
          detectionSettings: {
            person: true,
            vehicle: true,
            face: false,
            sensitivity: 0.7,
            notificationsEnabled: true,
            alarmEnabled: true,
            ...(c.detection_settings as Partial<DetectionSettings>),
          },
          createdAt: new Date(c.created_at),
          updatedAt: new Date(c.updated_at || c.created_at),
        };
      });

      // Persist for next cold start (best-effort)
      await saveCamerasCache(cameras);

      // 🔒 Self-heal legacy rows: strip plaintext creds from rtsp_url in the DB
      // too (best-effort — the SQL migration covers everything in one pass).
      if (dirtyRows.length > 0) {
        void Promise.allSettled(
          dirtyRows.map(({ id, rtspUrl }) =>
            supabase
              .from('cameras')
              .update({ rtsp_url: rtspUrl, updated_at: new Date().toISOString() })
              .eq('id', id)
          )
        );
      }

      set({
        cameras,
        error: null,
        isOffline: false,
        isHydrated: true,
        isLoading: false,
      });

      // (Re)start the per-camera heartbeat with the fresh list
      get().startHealthMonitoring();

      // Process offline queue when back online
      await get().processOfflineQueue();
    } catch (error) {
      console.error('[CameraStore] Fetch failed:', error);

      // Stale-while-revalidate: keep whatever we already show (cache or live)
      const existing = get().cameras;
      if (existing.length > 0) {
        set({
          isLoading: false,
          isHydrated: true,
          isOffline: true,
          // Soft notice — data on screen is still valid/cached
          error: null,
        });
        // Ensure heartbeat runs against the list we're showing
        if (!get().healthMonitorCleanup) {
          get().startHealthMonitoring();
        }
        return;
      }

      // Nothing visible yet — try cache as last resort
      const fallback = await loadCamerasCache();
      if (fallback.length > 0) {
        set({
          cameras: fallback,
          isLoading: false,
          isHydrated: true,
          isOffline: true,
          error: null,
        });
        get().startHealthMonitoring();
        return;
      }

      const message = error instanceof Error ? error.message : 'Failed to fetch cameras';
      logError(error, 'CameraStore.fetchCameras');
      set({ error: message, isLoading: false, isHydrated: true, isOffline: true });
    } finally {
      set({ isLoading: false });
    }
  },

  /**
   * Add a new camera
   */
  addCamera: async (cameraData) => {
    // Auth check — a fetch failure here means we're offline. Queue the write
    // instead of silently dropping the camera the user just configured.
    let user: { id: string } | null = null;
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      user = authUser;
    } catch (error) {
      if (!isNetworkError(error)) throw error;
      if (!isReplayingQueue) {
        await get().queueOfflineOperation({ type: 'add', data: cameraData });
      }
      logError(error, 'CameraStore.addCamera.offline');
      throw createAppError(
        'NETWORK_ERROR',
        error instanceof Error ? error.message : 'Network error — camera queued for sync',
        {
          userMessage: 'No network — camera queued and will sync when you\'re back online.',
        }
      );
    }
    if (!user) {
      throw createAppError('AUTH_ERROR', 'User not authenticated');
    }

    const { cameras } = get();

    // Check subscription limits
    const { data: profile } = await supabase
      .from('profiles')
      .select('subscription_tier')
      .eq('id', user.id)
      .single();

    const tier = profile?.subscription_tier || 'free';
    const limits: Record<string, number> = { free: 2, pro: 100, business: 100 };

    if (cameras.length >= limits[tier]) {
      throw createAppError(
        'QUOTA_EXCEEDED',
        `Camera limit reached for ${tier} tier`,
        { userMessage: `Camera limit reached (${limits[tier]}). Upgrade to Pro for unlimited cameras.` }
      );
    }

    // Encrypt password before storing
    let encryptedPassword: string | undefined;
    if (cameraData.password) {
      try {
        encryptedPassword = encryptPassword(cameraData.password, user.id);
      } catch (error) {
        logError(error, 'CameraStore.addCamera.encryptPassword');
        // Store as plain text if encryption fails (shouldn't happen)
        encryptedPassword = cameraData.password;
      }
    }

    // 🔒 Credentials never live inside a URL — strip any user:pass@ a caller
    // baked into rtspUrl before it is validated, stored, or cached.
    const rtspUrl = sanitizeRtspUrl(cameraData.rtspUrl);

    // Validate RTSP URL format before saving
    const connectionTest = await get().testConnection(rtspUrl);
    const isActive = connectionTest.success;

    let data: { id: string; [key: string]: any } | null = null;
    try {
      const result = await supabase
        .from('cameras')
        .insert({
          user_id: user.id,
          name: cameraData.name,
          rtsp_url: rtspUrl,
          username: cameraData.username,
          password: encryptedPassword,
          is_active: isActive,
          detection_settings: cameraData.detectionSettings,
        })
        .select()
        .single();

      if (result.error) throw result.error;
      data = result.data;
    } catch (error) {
      if (!isNetworkError(error)) {
        logError(error, 'CameraStore.addCamera');
        throw createAppError(
          'CAMERA_ERROR',
          (error as { message?: string })?.message ?? 'Failed to add camera'
        );
      }
      // Network failure → queue the write so it's replayed (not dropped)
      if (!isReplayingQueue) {
        await get().queueOfflineOperation({ type: 'add', data: cameraData });
      }
      throw createAppError(
        'NETWORK_ERROR',
        error instanceof Error ? error.message : 'Network error — camera queued for sync',
        {
          userMessage: 'No network — camera queued and will sync when you\'re back online.',
        }
      );
    }

    if (!data) {
      throw createAppError('CAMERA_ERROR', 'Failed to add camera');
    }

    const newCamera: Camera = {
      id: data.id,
      userId: data.user_id,
      name: data.name,
      rtspUrl: data.rtsp_url,
      username: data.username || undefined,
      password: data.password || undefined,
      isActive: data.is_active,
      thumbnailUrl: data.thumbnail_url || undefined,
      detectionSettings: data.detection_settings as DetectionSettings,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
    };

    set({ cameras: [newCamera, ...get().cameras] });
    // Keep cold-start cache in sync
    await saveCamerasCache(get().cameras);

    // Trigger happy moment for ASO review
    reviewManager.onHappyMoment('camera-added');

    return newCamera;
  },

  /**
   * Update an existing camera
   */
  updateCamera: async (id, updates) => {
    // Auth check — a fetch failure here means we're offline; queue the change
    // instead of dropping the user's edit.
    let user: { id: string } | null = null;
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      user = authUser;
    } catch (error) {
      if (!isNetworkError(error)) throw error;
      if (!isReplayingQueue) {
        await get().queueOfflineOperation({ type: 'update', id, data: updates });
      }
      throw createAppError(
        'NETWORK_ERROR',
        error instanceof Error ? error.message : 'Network error — update queued for sync',
        {
          userMessage: 'No network — update queued and will sync when you\'re back online.',
        }
      );
    }

    // Handle password encryption for updates
    let processedUpdates = { ...updates };
    // 🔒 Never store a credential-bearing URL — strip any user:pass@ first.
    if (typeof updates.rtspUrl === 'string') {
      processedUpdates.rtspUrl = sanitizeRtspUrl(updates.rtspUrl);
    }
    if (updates.password && user) {
      try {
        // Only encrypt if not already encrypted
        if (!isEncrypted(updates.password)) {
          processedUpdates.password = encryptPassword(updates.password, user.id);
        }
      } catch (error) {
        logError(error, 'CameraStore.updateCamera.encryptPassword');
      }
    }

    try {
      const result = await supabase
        .from('cameras')
        .update({
          name: processedUpdates.name,
          rtsp_url: processedUpdates.rtspUrl,
          username: processedUpdates.username,
          password: processedUpdates.password,
          is_active: processedUpdates.isActive,
          detection_settings: processedUpdates.detectionSettings,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (result.error) throw result.error;
    } catch (error) {
      if (!isNetworkError(error)) {
        logError(error, 'CameraStore.updateCamera');
        throw createAppError(
          'CAMERA_ERROR',
          (error as { message?: string })?.message ?? 'Failed to update camera'
        );
      }
      // Network failure → queue the change so it's replayed (not dropped)
      if (!isReplayingQueue) {
        await get().queueOfflineOperation({ type: 'update', id, data: updates });
      }
      throw createAppError(
        'NETWORK_ERROR',
        error instanceof Error ? error.message : 'Network error — update queued for sync',
        {
          userMessage: 'No network — update queued and will sync when you\'re back online.',
        }
      );
    }

    set({
      cameras: get().cameras.map((c) =>
        c.id === id
          ? {
              ...c,
              ...updates,
              rtspUrl:
                typeof updates.rtspUrl === 'string'
                  ? sanitizeRtspUrl(updates.rtspUrl)
                  : c.rtspUrl,
              updatedAt: new Date(),
            }
          : c
      ),
    });
    await saveCamerasCache(get().cameras);
  },

  /**
   * Delete a camera
   */
  deleteCamera: async (id) => {
    try {
      const result = await supabase.from('cameras').delete().eq('id', id);
      if (result.error) throw result.error;
    } catch (error) {
      if (!isNetworkError(error)) {
        logError(error, 'CameraStore.deleteCamera');
        throw createAppError(
          'CAMERA_ERROR',
          (error as { message?: string })?.message ?? 'Failed to delete camera'
        );
      }
      // Network failure → queue the deletion so it isn't silently lost
      if (!isReplayingQueue) {
        await get().queueOfflineOperation({ type: 'delete', id });
      }
      throw createAppError(
        'NETWORK_ERROR',
        error instanceof Error ? error.message : 'Network error — deletion queued for sync',
        {
          userMessage: 'No network — deletion queued and will sync when you\'re back online.',
        }
      );
    }

    set({
      cameras: get().cameras.filter((c) => c.id !== id),
      selectedCamera: get().selectedCamera?.id === id ? null : get().selectedCamera,
    });
    await saveCamerasCache(get().cameras);
  },

  /**
   * Select a camera for viewing
   */
  selectCamera: (camera) => set({ selectedCamera: camera }),

  /**
   * Test camera connection
   * Now uses real network testing instead of just URL validation
   */
  testConnection: async (rtspUrl: string): Promise<ConnectionTestResult> => {
    set({ isTestingConnection: true });

    try {
      // 🔒 Never key or pass a credential-bearing URL around
      const cleanUrl = sanitizeRtspUrl(rtspUrl);
      const result = await testCameraConnection(cleanUrl, {
        timeoutMs: 5000,
        retryCount: 1,
      });

      // Store the test result
      const parsed = new URL(cleanUrl.replace('rtsp://', 'http://'));
      const key = `${parsed.hostname}:${parsed.port || '554'}`;

      set(state => ({
        connectionTests: {
          ...state.connectionTests,
          [key]: result,
        },
      }));

      return result;
    } catch (error) {
      logError(error, 'CameraStore.testConnection');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection test failed',
        timestamp: new Date(),
      };
    } finally {
      set({ isTestingConnection: false });
    }
  },

  /**
   * Start health monitoring for all cameras (heartbeat)
   * Idempotent: replaces any existing monitor so the camera list stays fresh.
   * Returns a cleanup function to stop monitoring.
   */
  startHealthMonitoring: () => {
    // Replace any existing monitor (stale camera list, duplicate start)
    const existing = get().healthMonitorCleanup;
    if (existing) {
      existing();
    }

    const { cameras } = get();

    if (cameras.length === 0) {
      set({ healthMonitorCleanup: null });
      return () => { }; // No cameras to monitor
    }

    const cleanup = createHealthMonitor(
      cameras.map(c => ({ id: c.id, rtspUrl: c.rtspUrl })),
      (cameraId, health) => {
        // Update health state
        set(state => ({
          cameraHealth: {
            ...state.cameraHealth,
            [cameraId]: health,
          },
        }));

        // Persist health badges for next cold start (fire-and-forget)
        void saveHealthCache(get().cameraHealth);

        // Reflect settled results in the camera's isActive flag.
        // 'reconnecting' is transient — don't flip isActive on blips.
        const camera = get().cameras.find(c => c.id === cameraId);
        if (
          camera &&
          (health.status === 'online' || health.status === 'offline') &&
          camera.isActive !== health.isOnline
        ) {
          // Update locally without hitting the database every time
          set(state => ({
            cameras: state.cameras.map(c =>
              c.id === cameraId ? { ...c, isActive: health.isOnline } : c
            ),
          }));
        }
      },
      30000 // Heartbeat every 30 seconds
    );

    set({ healthMonitorCleanup: cleanup });
    return cleanup;
  },

  /**
   * Stop health monitoring
   */
  stopHealthMonitoring: () => {
    const { healthMonitorCleanup } = get();
    if (healthMonitorCleanup) {
      healthMonitorCleanup();
      set({ healthMonitorCleanup: null });
    }
  },

  /**
   * Get health info for a specific camera
   */
  getCameraHealth: (cameraId: string) => {
    return get().cameraHealth[cameraId];
  },

  /**
   * Clear error state
   */
  clearError: () => set({ error: null }),

  /**
   * Reset store to initial state
   */
  reset: () => {
    // Stop any pending offline-queue retry before wiping state
    if (offlineQueueRetryTimer) {
      clearTimeout(offlineQueueRetryTimer);
      offlineQueueRetryTimer = null;
    }
    // Stop health monitoring before resetting
    get().stopHealthMonitoring();
    set({ ...initialState });
  },

  /**
   * Clear the camera cache (call on sign-out).
   *
   * Wipes EVERYTHING camera-related for the signed-out user so the next user
   * on a shared device can never hydrate leftovers from this session:
   * - AsyncStorage: camera list (incl. cached RTSP URLs), health badges,
   *   offline queue (via clearCameraCache)
   * - In-memory store: cameras, selectedCamera, health, connection tests,
   *   offline queue, and the running health monitor
   */
  clearCache: async () => {
    // Stop any pending offline-queue retry before wiping state
    if (offlineQueueRetryTimer) {
      clearTimeout(offlineQueueRetryTimer);
      offlineQueueRetryTimer = null;
    }
    // Stop health monitoring before wiping state
    get().stopHealthMonitoring();
    // Wipe persisted AsyncStorage camera data (cameras, health, offline queue)
    await clearCameraCache();
    // Wipe in-memory store state
    set({ ...initialState });
  },

  /**
   * Queue an operation for when offline.
   * The queue is persisted via the shared cache helper so the key/format stay
   * consistent with cameraCache and survive cold starts.
   */
  queueOfflineOperation: async (operation: QueuedOperation) => {
    const queue = get().offlineQueue;
    const updatedQueue = [...queue, { ...operation, timestamp: Date.now() }];
    set({ offlineQueue: updatedQueue, isOffline: true });

    // Persist queue to AsyncStorage (best-effort)
    await saveOfflineQueue(updatedQueue);
  },

  /**
   * Process queued operations when back online.
   *
   * Retry-in-place with exponential backoff (same policy as RTSP reconnect):
   * a failed op stays in the queue, records its failure, and is not retried
   * until its `nextRetryAt` window opens. Once an op exhausts `maxAttempts`
   * auto-retry slows to a crawl and `offlineQueueError` is surfaced so the
   * failure is visible instead of silently dropped. Successful ops are the
   * ONLY ones removed from the queue.
   */
  processOfflineQueue: async () => {
    const queue = get().offlineQueue;
    if (queue.length === 0) return;

    console.log(`[CameraStore] Processing ${queue.length} queued operations`);

    const now = Date.now();
    const remaining: QueuedOperation[] = [];
    let exhaustedError: string | null = null;
    isReplayingQueue = true;

    try {
      for (const operation of queue) {
        const attempts = operation.attempts ?? 0;

        // Backoff gate — not yet time to retry. Keep the op, don't spam the server.
        if (operation.nextRetryAt && now < operation.nextRetryAt) {
          remaining.push(operation);
          continue;
        }

        try {
          if (operation.type === 'add' && operation.data) {
            // Retry add operation
            await get().addCamera(operation.data as Parameters<CameraState['addCamera']>[0]);
          } else if (operation.type === 'update' && operation.id) {
            // Retry update operation
            await get().updateCamera(operation.id, operation.data as Partial<Camera>);
          } else if (operation.type === 'delete' && operation.id) {
            // Retry delete operation
            await get().deleteCamera(operation.id);
          }
          // Success → op dropped (not pushed back into the queue)
        } catch (error) {
          // AppError is a plain object; unwrap message without String() mangling
          const failure = isAppError(error)
            ? error.message
            : error instanceof Error
              ? error.message
              : String(error);

          if (attempts >= OFFLINE_QUEUE_RETRY.maxAttempts) {
            // Retries exhausted: keep the data, surface the failure, and only
            // reopen it on a later sync pass — never a tight automatic loop.
            exhaustedError = exhaustedError ?? failure;
            remaining.push({
              ...operation,
              attempts,
              lastError: failure,
              nextRetryAt: Date.now() + OFFLINE_QUEUE_RETRY.maxDelayMs,
            });
            continue;
          }

          // Exponential backoff: min(base * 2^attempts, cap) ± 20% jitter —
          // mirrors rtspStreamingService.#scheduleReconnect
          const exponential = OFFLINE_QUEUE_RETRY.baseDelayMs * Math.pow(2, attempts);
          const capped = Math.min(exponential, OFFLINE_QUEUE_RETRY.maxDelayMs);
          const delayMs = Math.round(capped * (0.8 + Math.random() * 0.4));

          remaining.push({
            ...operation,
            attempts: attempts + 1,
            lastError: failure,
            nextRetryAt: Date.now() + delayMs,
          });
        }
      }

      set({
        offlineQueue: remaining,
        // null during normal backoff recovery; set only once retries are
        // exhausted so failures are obvious — and cleared on full drain.
        offlineQueueError: remaining.length > 0 ? exhaustedError : null,
      });

      // Persist atomically after the pass — successes are gone for good
      await saveOfflineQueue(remaining);
    } finally {
      isReplayingQueue = false;
    }

    // Auto-retry at the earliest pending backoff window instead of waiting for
    // a manual pull-to-refresh / reconnect.
    scheduleOfflineQueueRetry();
  },
}));

/**
 * Schedule the next automatic offline-queue retry at the earliest pending
 * op's backoff window. No-op when nothing has a future retry window.
 */
function scheduleOfflineQueueRetry(): void {
  if (offlineQueueRetryTimer) {
    clearTimeout(offlineQueueRetryTimer);
    offlineQueueRetryTimer = null;
  }

  const queue = useCameraStore.getState().offlineQueue;
  const now = Date.now();
  let earliest = Infinity;

  for (const op of queue) {
    if (op.nextRetryAt && op.nextRetryAt > now) {
      earliest = Math.min(earliest, op.nextRetryAt);
    }
  }

  if (!Number.isFinite(earliest)) return;

  offlineQueueRetryTimer = setTimeout(() => {
    offlineQueueRetryTimer = null;
    void useCameraStore.getState().processOfflineQueue();
  }, Math.max(0, earliest - now));
}

/**
 * Helper to get decrypted password for a camera
 * Use this when you need the actual password for camera authentication
 */
export async function getDecryptedCameraPassword(
  camera: Camera
): Promise<string | undefined> {
  if (!camera.password) return undefined;

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return undefined;

    // If it looks encrypted, decrypt it
    if (isEncrypted(camera.password)) {
      return decryptPassword(camera.password, user.id);
    }

    // Return as-is if not encrypted (legacy data)
    return camera.password;
  } catch (error) {
    logError(error, 'getDecryptedCameraPassword');
    return undefined;
  }
}
