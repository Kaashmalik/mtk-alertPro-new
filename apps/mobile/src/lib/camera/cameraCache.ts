/**
 * Camera cache (AsyncStorage) — cold-start stale-while-revalidate helpers
 *
 * Pattern:
 *  1. App start → loadCache() paints the last-known list instantly
 *  2. fetchCameras() revalidates in the background
 *  3. Success → overwrite cache; failure → keep showing cache (offline mode)
 *
 * @module lib/camera/cameraCache
 */

import type { Camera } from '@/types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CameraConnectionStatus, CameraHealth } from './connectionService';
import { sanitizeRtspUrl } from './rtspHelper';

export const CAMERAS_CACHE_KEY = 'cameras-cache';
export const HEALTH_CACHE_KEY = 'camera-health-cache';
export const OFFLINE_QUEUE_KEY = 'camera-offline-queue';

/** Bump when the cached shape changes incompatibly */
const CACHE_VERSION = 1;

interface CamerasCacheEnvelope {
  version: number;
  savedAt: number;
  cameras: Camera[];
}

interface HealthCacheEnvelope {
  version: number;
  savedAt: number;
  /** cameraId → health with Dates serialized as ISO strings */
  health: Record<string, SerializedHealth>;
}

/** ConnectionTestResult with timestamp serialized as ISO string */
export type SerializedConnectionTestResult = Omit<
  CameraHealth['lastTest'],
  'timestamp'
> & { timestamp: string };

/** CameraHealth with Date fields as ISO strings for JSON round-trip */
export type SerializedHealth = Omit<
  CameraHealth,
  'lastOnline' | 'lastChecked' | 'lastTest'
> & {
  lastOnline?: string;
  lastChecked?: string;
  lastTest: SerializedConnectionTestResult;
};

/** Minimal offline-queue entry shape (mirrors cameraStore.QueuedOperation) */
export interface CachedQueuedOperation {
  type: 'add' | 'update' | 'delete';
  id?: string;
  data?: unknown;
  /** Set when the write is first queued */
  timestamp?: number;
  /** Retry count (incremented when a replay fails) */
  attempts?: number;
  /** Last failure message (surfaced to the user) */
  lastError?: string;
  /** Earliest timestamp this op may be retried (exponential backoff) */
  nextRetryAt?: number;
}

// ---------------------------------------------------------------------------
// Serialize / deserialize (exported for tests)
// ---------------------------------------------------------------------------

export function serializeHealth(
  health: Record<string, CameraHealth>,
): Record<string, SerializedHealth> {
  const out: Record<string, SerializedHealth> = {};
  for (const [id, h] of Object.entries(health)) {
    out[id] = {
      ...h,
      lastOnline:
        h.lastOnline instanceof Date ? h.lastOnline.toISOString() : undefined,
      lastChecked:
        h.lastChecked instanceof Date ? h.lastChecked.toISOString() : undefined,
      lastTest: {
        ...h.lastTest,
        timestamp:
          h.lastTest.timestamp instanceof Date
            ? h.lastTest.timestamp.toISOString()
            : String(h.lastTest.timestamp),
      },
    };
  }
  return out;
}

export function deserializeHealth(
  raw: Record<string, SerializedHealth>,
): Record<string, CameraHealth> {
  const out: Record<string, CameraHealth> = {};
  for (const [id, h] of Object.entries(raw)) {
    if (!h || typeof h !== 'object' || !h.cameraId) continue;
    out[id] = {
      ...h,
      status: normalizeStatus(h.status),
      lastOnline: h.lastOnline ? new Date(h.lastOnline) : undefined,
      lastChecked: h.lastChecked ? new Date(h.lastChecked) : undefined,
      lastTest: {
        ...h.lastTest,
        timestamp: h.lastTest?.timestamp
          ? new Date(h.lastTest.timestamp)
          : new Date(),
      },
    };
  }
  return out;
}

function normalizeStatus(status: unknown): CameraConnectionStatus {
  if (
    status === 'online' ||
    status === 'offline' ||
    status === 'reconnecting' ||
    status === 'unknown'
  ) {
    return status;
  }
  return 'unknown';
}

/** Revive ISO date strings on a cached Camera */
function reviveCamera(c: Camera): Camera {
  return {
    ...c,
    createdAt: c.createdAt ? new Date(c.createdAt) : new Date(0),
    updatedAt: c.updatedAt ? new Date(c.updatedAt) : new Date(0),
  };
}

/**
 * 🔒 Never persist a credential-bearing URL: strip any user:pass@ from
 * rtspUrl on the way into and out of AsyncStorage. Credentials live only in
 * the encrypted username/password columns.
 */
function sanitizeCamera(c: Camera): Camera {
  if (
    !c ||
    typeof c !== 'object' ||
    typeof (c as { rtspUrl?: unknown }).rtspUrl !== 'string'
  ) {
    return c;
  }
  const rtspUrl = sanitizeRtspUrl(c.rtspUrl);
  return rtspUrl === c.rtspUrl ? c : { ...c, rtspUrl };
}

function isValidCamera(c: unknown): c is Camera {
  if (!c || typeof c !== 'object') return false;
  const cam = c as Partial<Camera>;
  if (
    typeof cam.id !== 'string' ||
    typeof cam.name !== 'string' ||
    typeof cam.rtspUrl !== 'string'
  ) {
    return false;
  }
  // detectionSettings must be an object. A cache entry written before this
  // check (or a partially-saved camera) can carry null, which would then throw
  // across the whole camera detail screen on every cold start.
  if (cam.detectionSettings !== undefined) {
    if (
      cam.detectionSettings === null ||
      typeof cam.detectionSettings !== 'object' ||
      Array.isArray(cam.detectionSettings)
    ) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Persist the camera list. Failures are swallowed (cache is best-effort).
 */
export async function saveCamerasCache(cameras: Camera[]): Promise<void> {
  try {
    const envelope: CamerasCacheEnvelope = {
      version: CACHE_VERSION,
      savedAt: Date.now(),
      cameras: cameras.map(sanitizeCamera),
    };
    await AsyncStorage.setItem(CAMERAS_CACHE_KEY, JSON.stringify(envelope));
  } catch (error) {
    console.warn('[CameraCache] Failed to save cameras:', error);
  }
}

/**
 * Load the cached camera list.
 * Returns [] when missing, corrupt, or wrong version.
 * Supports the legacy bare-array format (pre-envelope).
 */
export async function loadCamerasCache(): Promise<Camera[]> {
  try {
    const raw = await AsyncStorage.getItem(CAMERAS_CACHE_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);

    // Legacy format: bare Camera[]
    if (Array.isArray(parsed)) {
      return parsed.filter(isValidCamera).map(reviveCamera).map(sanitizeCamera);
    }

    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as CamerasCacheEnvelope).version === CACHE_VERSION
    ) {
      const envelope = parsed as CamerasCacheEnvelope;
      if (!Array.isArray(envelope.cameras)) return [];
      return envelope.cameras
        .filter(isValidCamera)
        .map(reviveCamera)
        .map(sanitizeCamera);
    }

    return [];
  } catch (error) {
    console.warn('[CameraCache] Failed to load cameras:', error);
    return [];
  }
}

/** Persist heartbeat health snapshots */
export async function saveHealthCache(
  health: Record<string, CameraHealth>,
): Promise<void> {
  try {
    const envelope: HealthCacheEnvelope = {
      version: CACHE_VERSION,
      savedAt: Date.now(),
      health: serializeHealth(health),
    };
    await AsyncStorage.setItem(HEALTH_CACHE_KEY, JSON.stringify(envelope));
  } catch (error) {
    console.warn('[CameraCache] Failed to save health:', error);
  }
}

/** Load cached heartbeat health (for instant status badges on cold start) */
export async function loadHealthCache(): Promise<Record<string, CameraHealth>> {
  try {
    const raw = await AsyncStorage.getItem(HEALTH_CACHE_KEY);
    if (!raw) return {};

    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as HealthCacheEnvelope).version === CACHE_VERSION
    ) {
      const envelope = parsed as HealthCacheEnvelope;
      if (!envelope.health || typeof envelope.health !== 'object') return {};
      return deserializeHealth(envelope.health);
    }
    return {};
  } catch (error) {
    console.warn('[CameraCache] Failed to load health:', error);
    return {};
  }
}

/** Load the offline mutation queue */
export async function loadOfflineQueue(): Promise<CachedQueuedOperation[]> {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (op): op is CachedQueuedOperation =>
        !!op &&
        typeof op === 'object' &&
        (op as CachedQueuedOperation).type !== undefined,
    );
  } catch {
    return [];
  }
}

/**
 * Persist the offline mutation queue.
 * Empty queue removes the key; failures are swallowed (best-effort like other caches).
 */
export async function saveOfflineQueue(
  queue: CachedQueuedOperation[],
): Promise<void> {
  try {
    if (queue.length === 0) {
      await AsyncStorage.removeItem(OFFLINE_QUEUE_KEY);
    } else {
      await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    }
  } catch (error) {
    console.warn('[CameraCache] Failed to save offline queue:', error);
  }
}

/** Clear all camera-related cache (e.g. on sign-out) */
export async function clearCameraCache(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([
      CAMERAS_CACHE_KEY,
      HEALTH_CACHE_KEY,
      OFFLINE_QUEUE_KEY,
    ]);
  } catch (error) {
    console.warn('[CameraCache] Failed to clear:', error);
  }
}
