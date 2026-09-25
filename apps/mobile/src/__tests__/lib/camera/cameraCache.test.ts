/**
 * Camera cache tests — cold-start stale-while-revalidate helpers
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  saveCamerasCache,
  loadCamerasCache,
  saveHealthCache,
  loadHealthCache,
  loadOfflineQueue,
  clearCameraCache,
  serializeHealth,
  deserializeHealth,
  CAMERAS_CACHE_KEY,
  HEALTH_CACHE_KEY,
} from '@/lib/camera/cameraCache';
import type { CameraHealth } from '@/lib/camera/connectionService';
import { createMockCamera } from '../../setup';

function makeHealth(overrides: Partial<CameraHealth> = {}): CameraHealth {
  return {
    cameraId: 'cam-1',
    status: 'online',
    isOnline: true,
    avgLatency: 42,
    lastOnline: new Date('2024-06-01T12:00:00.000Z'),
    lastChecked: new Date('2024-06-01T12:00:05.000Z'),
    failureCount: 0,
    lastTest: {
      success: true,
      latency: 42,
      timestamp: new Date('2024-06-01T12:00:05.000Z'),
    },
    ...overrides,
  };
}

describe('cameraCache', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  describe('cameras cache', () => {
    it('round-trips cameras with Date revival', async () => {
      const cameras = [
        createMockCamera({
          id: 'cam-1',
          createdAt: new Date('2024-01-15T08:00:00.000Z'),
          updatedAt: new Date('2024-02-01T09:30:00.000Z'),
        }),
      ];

      await saveCamerasCache(cameras);
      const loaded = await loadCamerasCache();

      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe('cam-1');
      expect(loaded[0].createdAt).toBeInstanceOf(Date);
      expect(loaded[0].createdAt.toISOString()).toBe('2024-01-15T08:00:00.000Z');
      expect(loaded[0].updatedAt.toISOString()).toBe('2024-02-01T09:30:00.000Z');
    });

    it('writes versioned envelope', async () => {
      await saveCamerasCache([createMockCamera()]);
      const raw = await AsyncStorage.getItem(CAMERAS_CACHE_KEY);
      const parsed = JSON.parse(raw!);
      expect(parsed).toMatchObject({
        version: 1,
        savedAt: expect.any(Number),
        cameras: expect.any(Array),
      });
    });

    it('returns [] when missing', async () => {
      expect(await loadCamerasCache()).toEqual([]);
    });

    it('returns [] on corrupt JSON', async () => {
      await AsyncStorage.setItem(CAMERAS_CACHE_KEY, 'not-json{{{');
      expect(await loadCamerasCache()).toEqual([]);
    });

    it('returns [] on wrong version', async () => {
      await AsyncStorage.setItem(
        CAMERAS_CACHE_KEY,
        JSON.stringify({ version: 99, savedAt: 1, cameras: [createMockCamera()] })
      );
      expect(await loadCamerasCache()).toEqual([]);
    });

    it('supports legacy bare-array format', async () => {
      const legacy = [
        {
          id: 'legacy-1',
          userId: 'u1',
          name: 'Legacy',
          rtspUrl: 'rtsp://10.0.0.1/stream',
          isActive: true,
          detectionSettings: { person: true, vehicle: true, sensitivity: 0.7, notificationsEnabled: true, alarmEnabled: true },
          createdAt: '2023-01-01T00:00:00.000Z',
          updatedAt: '2023-01-01T00:00:00.000Z',
        },
      ];
      await AsyncStorage.setItem(CAMERAS_CACHE_KEY, JSON.stringify(legacy));

      const loaded = await loadCamerasCache();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe('legacy-1');
      expect(loaded[0].createdAt).toBeInstanceOf(Date);
    });

    it('filters invalid camera entries', async () => {
      await saveCamerasCache([
        createMockCamera({ id: 'good' }),
        { id: 123 } as unknown as ReturnType<typeof createMockCamera>,
        null as unknown as ReturnType<typeof createMockCamera>,
      ]);
      const loaded = await loadCamerasCache();
      expect(loaded.map(c => c.id)).toEqual(['good']);
    });

    it('never persists credential-bearing URLs', async () => {
      const dirty = createMockCamera({
        id: 'cam-1',
        rtspUrl: 'rtsp://admin:secret@192.168.1.10:554/stream',
      });

      await saveCamerasCache([dirty]);
      const raw = await AsyncStorage.getItem(CAMERAS_CACHE_KEY);
      expect(raw).not.toContain('secret');

      const loaded = await loadCamerasCache();
      expect(loaded[0].rtspUrl).toBe('rtsp://192.168.1.10:554/stream');
      expect(loaded[0].rtspUrl).not.toContain('secret');
    });

    it('sanitizes legacy cache entries containing credentials', async () => {
      const legacy = [
        {
          id: 'legacy-1',
          userId: 'u1',
          name: 'Legacy',
          rtspUrl: 'rtsp://admin:pw@10.0.0.1/stream',
          isActive: true,
          detectionSettings: { person: true, vehicle: true, sensitivity: 0.7, notificationsEnabled: true, alarmEnabled: true },
          createdAt: '2023-01-01T00:00:00.000Z',
          updatedAt: '2023-01-01T00:00:00.000Z',
        },
      ];
      await AsyncStorage.setItem(CAMERAS_CACHE_KEY, JSON.stringify(legacy));

      const loaded = await loadCamerasCache();
      expect(loaded[0].rtspUrl).toBe('rtsp://10.0.0.1/stream');
      expect(loaded[0].rtspUrl).not.toContain('pw');
    });
  });

  describe('health cache', () => {
    it('round-trips health with Date revival', async () => {
      const health = { 'cam-1': makeHealth() };
      await saveHealthCache(health);

      const loaded = await loadHealthCache();
      expect(loaded['cam-1'].status).toBe('online');
      expect(loaded['cam-1'].lastOnline).toBeInstanceOf(Date);
      expect(loaded['cam-1'].lastChecked).toBeInstanceOf(Date);
      expect(loaded['cam-1'].lastTest.timestamp).toBeInstanceOf(Date);
      expect(loaded['cam-1'].avgLatency).toBe(42);
    });

    it('returns {} when missing or corrupt', async () => {
      expect(await loadHealthCache()).toEqual({});
      await AsyncStorage.setItem(HEALTH_CACHE_KEY, '%%');
      expect(await loadHealthCache()).toEqual({});
    });

    it('normalizes unknown status to unknown', () => {
      const raw = serializeHealth({ 'cam-1': makeHealth() });
      // Simulate a bad status sneaking in
      (raw['cam-1'] as { status: string }).status = 'weird';
      const revived = deserializeHealth(raw);
      expect(revived['cam-1'].status).toBe('unknown');
    });

    it('serialize/deserialize preserves isOnline and failureCount', () => {
      const health = {
        'cam-1': makeHealth({ status: 'offline', isOnline: false, failureCount: 3 }),
      };
      const round = deserializeHealth(serializeHealth(health));
      expect(round['cam-1'].status).toBe('offline');
      expect(round['cam-1'].isOnline).toBe(false);
      expect(round['cam-1'].failureCount).toBe(3);
    });
  });

  describe('offline queue', () => {
    it('round-trips queue entries', async () => {
      const queue = [
        { type: 'delete' as const, id: 'cam-9', timestamp: Date.now() },
        { type: 'update' as const, id: 'cam-1', data: { name: 'X' }, timestamp: Date.now() },
      ];
      await AsyncStorage.setItem('camera-offline-queue', JSON.stringify(queue));

      const loaded = await loadOfflineQueue();
      expect(loaded).toHaveLength(2);
      expect(loaded[0].type).toBe('delete');
      expect(loaded[1].id).toBe('cam-1');
    });

    it('returns [] when missing or not an array', async () => {
      expect(await loadOfflineQueue()).toEqual([]);
      await AsyncStorage.setItem('camera-offline-queue', '{"nope":true}');
      expect(await loadOfflineQueue()).toEqual([]);
    });
  });

  describe('clearCameraCache', () => {
    it('removes all camera-related keys', async () => {
      await saveCamerasCache([createMockCamera()]);
      await saveHealthCache({ 'cam-1': makeHealth() });
      await AsyncStorage.setItem('camera-offline-queue', '[]');

      await clearCameraCache();

      expect(await AsyncStorage.getItem(CAMERAS_CACHE_KEY)).toBeNull();
      expect(await AsyncStorage.getItem(HEALTH_CACHE_KEY)).toBeNull();
      expect(await AsyncStorage.getItem('camera-offline-queue')).toBeNull();
    });
  });
});
