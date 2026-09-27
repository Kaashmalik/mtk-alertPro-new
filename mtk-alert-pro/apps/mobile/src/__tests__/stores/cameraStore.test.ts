/**
 * Camera Store Tests
 */

// `act` from react — avoids monorepo react-test-renderer@19 vs react@18 mismatch
import { act } from 'react';
import { useCameraStore, getDecryptedCameraPassword, OFFLINE_QUEUE_RETRY } from '@/stores/cameraStore';
import { supabase } from '@/lib/supabase/client';
import {
  clearCameraCache,
  saveCamerasCache,
  saveHealthCache,
  loadOfflineQueue,
} from '@/lib/camera/cameraCache';
import { createMockCamera } from '../setup';

// Reset store before each test
const resetStore = () => {
  const { reset } = useCameraStore.getState();
  reset();
};

describe('Camera Store', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetStore();
    // Clear any cache left by prior tests (AsyncStorage mock is in-memory)
    await clearCameraCache();
  });

  // =========================================================================
  // Initial State
  // =========================================================================
  describe('Initial State', () => {
    it('should have correct initial state', () => {
      const state = useCameraStore.getState();

      expect(state.cameras).toEqual([]);
      expect(state.isLoading).toBe(false);
      expect(state.isHydrated).toBe(false);
      expect(state.error).toBeNull();
      expect(state.selectedCamera).toBeNull();
      expect(state.connectionTests).toEqual({});
      expect(state.cameraHealth).toEqual({});
      expect(state.isTestingConnection).toBe(false);
    });
  });

  // =========================================================================
  // hydrateFromCache (cold-start stale-while-revalidate)
  // =========================================================================
  describe('hydrateFromCache', () => {
    it('loads cameras and health from AsyncStorage', async () => {
      const cached = createMockCamera({ id: 'cached-1', name: 'Cached Cam' });
      await saveCamerasCache([cached]);
      await saveHealthCache({
        'cached-1': {
          cameraId: 'cached-1',
          status: 'online',
          isOnline: true,
          avgLatency: 10,
          failureCount: 0,
          lastTest: { success: true, timestamp: new Date() },
          lastChecked: new Date(),
        },
      });

      await act(async () => {
        await useCameraStore.getState().hydrateFromCache();
      });

      const state = useCameraStore.getState();
      expect(state.isHydrated).toBe(true);
      expect(state.cameras).toHaveLength(1);
      expect(state.cameras[0].id).toBe('cached-1');
      expect(state.cameras[0].name).toBe('Cached Cam');
      expect(state.cameraHealth['cached-1'].status).toBe('online');
      expect(state.isOffline).toBe(true); // cached paint, awaiting revalidate
    });

    it('marks isHydrated even when cache is empty', async () => {
      await act(async () => {
        await useCameraStore.getState().hydrateFromCache();
      });

      const state = useCameraStore.getState();
      expect(state.isHydrated).toBe(true);
      expect(state.cameras).toEqual([]);
      expect(state.isOffline).toBe(false);
    });

    it('does not overwrite live cameras with older cache', async () => {
      const live = createMockCamera({ id: 'live-1', name: 'Live' });
      useCameraStore.setState({ cameras: [live] });

      await saveCamerasCache([createMockCamera({ id: 'stale-1', name: 'Stale' })]);

      await act(async () => {
        await useCameraStore.getState().hydrateFromCache();
      });

      expect(useCameraStore.getState().cameras[0].id).toBe('live-1');
    });

    it('merges health without wiping fresher entries', async () => {
      const fresh = {
        cameraId: 'cam-fresh',
        status: 'online' as const,
        isOnline: true,
        avgLatency: 5,
        failureCount: 0,
        lastTest: { success: true, timestamp: new Date() },
      };
      useCameraStore.setState({ cameraHealth: { 'cam-fresh': fresh } });

      await saveHealthCache({
        'cam-stale': {
          cameraId: 'cam-stale',
          status: 'offline',
          isOnline: false,
          avgLatency: 99,
          failureCount: 3,
          lastTest: { success: false, timestamp: new Date() },
        },
      });

      await act(async () => {
        await useCameraStore.getState().hydrateFromCache();
      });

      const health = useCameraStore.getState().cameraHealth;
      expect(health['cam-fresh'].avgLatency).toBe(5);
      expect(health['cam-stale'].status).toBe('offline');
    });
  });

  // =========================================================================
  // fetchCameras
  // =========================================================================
  describe('fetchCameras', () => {
    it('should fetch and transform cameras', async () => {
      const mockCameraData = {
        id: 'cam-1',
        user_id: 'user-1',
        name: 'Test Camera',
        rtsp_url: 'rtsp://192.168.1.100:554/stream',
        username: 'admin',
        password: 'encrypted_password',
        is_active: true,
        thumbnail_url: null,
        detection_settings: { person: true, vehicle: true },
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({
          data: [mockCameraData],
          error: null,
        }),
      });

      await act(async () => {
        await useCameraStore.getState().fetchCameras();
      });

      const state = useCameraStore.getState();

      expect(state.cameras).toHaveLength(1);
      expect(state.cameras[0].id).toBe('cam-1');
      expect(state.cameras[0].name).toBe('Test Camera');
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('should set error on failure when no cache is available', async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({
          data: null,
          error: new Error('Database error'),
        }),
      });

      await act(async () => {
        await useCameraStore.getState().fetchCameras();
      });

      const state = useCameraStore.getState();

      expect(state.cameras).toEqual([]);
      expect(state.error).toBeDefined();
      expect(state.isOffline).toBe(true);
      expect(state.isHydrated).toBe(true);
    });

    it('keeps showing cached cameras when network fails (stale-while-revalidate)', async () => {
      await saveCamerasCache([createMockCamera({ id: 'swr-1' })]);

      await act(async () => {
        await useCameraStore.getState().hydrateFromCache();
      });

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        order: jest.fn().mockRejectedValue(new Error('Network down')),
      });

      await act(async () => {
        await useCameraStore.getState().fetchCameras();
      });

      const state = useCameraStore.getState();
      expect(state.cameras).toHaveLength(1);
      expect(state.cameras[0].id).toBe('swr-1');
      expect(state.isOffline).toBe(true);
      expect(state.error).toBeNull(); // soft notice — list stays usable
      expect(state.isLoading).toBe(false);
    });

    it('should set loading state during fetch', async () => {
      let resolvePromise: () => void;
      const pendingPromise = new Promise<void>(resolve => {
        resolvePromise = resolve;
      });

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        order: jest.fn().mockImplementation(async () => {
          await pendingPromise;
          return { data: [], error: null };
        }),
      });

      const fetchPromise = useCameraStore.getState().fetchCameras();

      // Should be loading
      expect(useCameraStore.getState().isLoading).toBe(true);

      // Resolve the fetch
      resolvePromise!();
      await fetchPromise;

      // Should not be loading
      expect(useCameraStore.getState().isLoading).toBe(false);
    });
  });

  // =========================================================================
  // addCamera
  // =========================================================================
  describe('addCamera', () => {
    beforeEach(() => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null,
      });
    });

    it('should add camera successfully', async () => {
      const newCameraData = {
        id: 'new-cam',
        user_id: 'user-1',
        name: 'New Camera',
        rtsp_url: 'rtsp://192.168.1.101:554/stream',
        is_active: true,
        detection_settings: { person: true, vehicle: true },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Mock profile check
      (supabase.from as jest.Mock).mockImplementation((table) => {
        if (table === 'profiles') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: { subscription_tier: 'pro' },
              error: null,
            }),
          };
        }
        if (table === 'cameras') {
          return {
            insert: jest.fn().mockReturnThis(),
            select: jest.fn().mockReturnThis(),
            // Quota check: a head/count query that resolves on eq().
            eq: jest.fn().mockResolvedValue({ count: 0, error: null }),
            single: jest.fn().mockResolvedValue({
              data: newCameraData,
              error: null,
            }),
          };
        }
        return {
          select: jest.fn().mockReturnThis(),
        };
      });

      // Mock connection test
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      await act(async () => {
        const camera = await useCameraStore.getState().addCamera({
          name: 'New Camera',
          rtspUrl: 'rtsp://192.168.1.101:554/stream',
          isActive: true,
          detectionSettings: {
            person: true,
            vehicle: true,
            face: false,
            sensitivity: 0.7,
            notificationsEnabled: true,
            alarmEnabled: true,
          },
        });

        expect(camera.id).toBe('new-cam');
      });

      const state = useCameraStore.getState();
      expect(state.cameras).toHaveLength(1);
    });

    it('should handle unauthenticated state', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: null },
        error: null,
      });

      // The addCamera function may throw or set error in store
      try {
        await useCameraStore.getState().addCamera({
          name: 'Test',
          rtspUrl: 'rtsp://test',
          isActive: true,
          detectionSettings: {
            person: true,
            vehicle: true,
            face: false,
            sensitivity: 0.7,
            notificationsEnabled: true,
            alarmEnabled: true,
          },
        });
        // If it doesn't throw, camera shouldn't be added
        const state = useCameraStore.getState();
        expect(state.cameras.length === 0 || state.error !== null).toBe(true);
      } catch (error) {
        // Expected - function threw an error for unauthenticated
        expect(error).toBeDefined();
      }
    });

    it('should handle camera limit', async () => {
      // Set up existing cameras
      useCameraStore.setState({
        cameras: [createMockCamera({ id: 'cam-1' }), createMockCamera({ id: 'cam-2' })],
      });

      (supabase.from as jest.Mock).mockImplementation((table) => {
        if (table === 'profiles') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: { subscription_tier: 'free' }, // Free tier = 2 cameras
              error: null,
            }),
          };
        }
        return {
          insert: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: null,
            error: { message: 'Camera limit reached' },
          }),
        };
      });

      // The addCamera function may throw or set error in store
      try {
        await useCameraStore.getState().addCamera({
          name: 'Third Camera',
          rtspUrl: 'rtsp://test',
          isActive: true,
          detectionSettings: {
            person: true,
            vehicle: true,
            face: false,
            sensitivity: 0.7,
            notificationsEnabled: true,
            alarmEnabled: true,
          },
        });
        // If it doesn't throw, check state
        const state = useCameraStore.getState();
        expect(state.cameras.length <= 2 || state.error !== null).toBe(true);
      } catch (error) {
        // Expected - function threw for limit reached
        expect(error).toBeDefined();
      }
    });
  });

  // =========================================================================
  // updateCamera
  // =========================================================================
  describe('updateCamera', () => {
    beforeEach(() => {
      useCameraStore.setState({
        cameras: [createMockCamera({ id: 'cam-1', name: 'Old Name' })],
      });

      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null,
      });
    });

    it('should update camera in store', async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ error: null }),
      });

      await act(async () => {
        await useCameraStore.getState().updateCamera('cam-1', { name: 'New Name' });
      });

      const camera = useCameraStore.getState().cameras[0];
      expect(camera.name).toBe('New Name');
    });

    it('should handle database error', async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ error: new Error('DB Error') }),
      });

      // The updateCamera function may throw or set error in store
      try {
        await useCameraStore.getState().updateCamera('cam-1', { name: 'New Name' });
        // If it doesn't throw, check state
        const state = useCameraStore.getState();
        expect(state.error !== null || state.cameras[0].name === 'Old Name').toBe(true);
      } catch (error) {
        // Expected - function threw for DB error
        expect(error).toBeDefined();
      }
    });
  });

  // =========================================================================
  // deleteCamera
  // =========================================================================
  describe('deleteCamera', () => {
    beforeEach(() => {
      useCameraStore.setState({
        cameras: [
          createMockCamera({ id: 'cam-1' }),
          createMockCamera({ id: 'cam-2' }),
        ],
        selectedCamera: createMockCamera({ id: 'cam-1' }),
      });
    });

    it('should remove camera from store', async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ error: null }),
      });

      await act(async () => {
        await useCameraStore.getState().deleteCamera('cam-1');
      });

      const state = useCameraStore.getState();
      expect(state.cameras).toHaveLength(1);
      expect(state.cameras[0].id).toBe('cam-2');
    });

    it('should clear selectedCamera if deleted', async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ error: null }),
      });

      await act(async () => {
        await useCameraStore.getState().deleteCamera('cam-1');
      });

      expect(useCameraStore.getState().selectedCamera).toBeNull();
    });
  });

  // =========================================================================
  // selectCamera
  // =========================================================================
  describe('selectCamera', () => {
    it('should set selected camera', () => {
      const camera = createMockCamera();

      act(() => {
        useCameraStore.getState().selectCamera(camera);
      });

      expect(useCameraStore.getState().selectedCamera).toEqual(camera);
    });

    it('should clear selected camera with null', () => {
      useCameraStore.setState({ selectedCamera: createMockCamera() });

      act(() => {
        useCameraStore.getState().selectCamera(null);
      });

      expect(useCameraStore.getState().selectedCamera).toBeNull();
    });
  });

  // =========================================================================
  // testConnection
  // =========================================================================
  describe('testConnection', () => {
    it('should test connection and return result', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      let result;
      await act(async () => {
        result = await useCameraStore.getState().testConnection(
          'rtsp://192.168.1.100:554/stream'
        );
      });

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('timestamp');
    });

    it('should store test result in connectionTests', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      await act(async () => {
        await useCameraStore.getState().testConnection(
          'rtsp://192.168.1.100:554/stream'
        );
      });

      const tests = useCameraStore.getState().connectionTests;
      expect(Object.keys(tests).length).toBeGreaterThan(0);
    });

    it('should handle invalid URL format', async () => {
      let result: any;
      await act(async () => {
        result = await useCameraStore.getState().testConnection(
          'invalid-url-format' // Invalid RTSP URL format
        );
      });

      expect(result).toBeDefined();
      expect((result as { success?: boolean })?.success).toBe(false);
      expect((result as { error?: string })?.error).toBeDefined();
    });
  });

  // =========================================================================
  // clearError
  // =========================================================================
  describe('clearError', () => {
    it('should clear error state', () => {
      useCameraStore.setState({ error: 'Some error' });

      act(() => {
        useCameraStore.getState().clearError();
      });

      expect(useCameraStore.getState().error).toBeNull();
    });
  });

  // =========================================================================
  // reset
  // =========================================================================
  describe('reset', () => {
    it('should reset to initial state', () => {
      useCameraStore.setState({
        cameras: [createMockCamera()],
        isLoading: true,
        error: 'Some error',
        selectedCamera: createMockCamera(),
      });

      act(() => {
        useCameraStore.getState().reset();
      });

      const state = useCameraStore.getState();
      expect(state.cameras).toEqual([]);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.selectedCamera).toBeNull();
    });
  });

  // =========================================================================
  // getDecryptedCameraPassword
  // =========================================================================
  describe('getDecryptedCameraPassword', () => {
    it('should return undefined for camera without password', async () => {
      const camera = createMockCamera({ password: undefined });

      const result = await getDecryptedCameraPassword(camera);

      expect(result).toBeUndefined();
    });

    it('should return undefined when not authenticated', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const camera = createMockCamera({ password: 'encrypted' });

      const result = await getDecryptedCameraPassword(camera);

      expect(result).toBeUndefined();
    });
  });

  // =========================================================================
  // offline queue (retry-with-backoff)
  // =========================================================================
  describe('offline queue (retry-with-backoff)', () => {
    afterEach(() => {
      // Cancel any scheduled auto-retry timer so it can't fire into a later test
      resetStore();
    });

    it('queues an add when offline instead of dropping it', async () => {
      (supabase.auth.getUser as jest.Mock).mockRejectedValueOnce(
        new TypeError('Network request failed')
      );

      let thrown: { code?: string } | undefined;
      try {
        await useCameraStore.getState().addCamera({
          name: 'Queued Cam',
          rtspUrl: 'rtsp://192.168.1.50:554/stream',
          isActive: true,
          detectionSettings: {
            person: true,
            vehicle: true,
            face: false,
            sensitivity: 0.7,
            notificationsEnabled: true,
            alarmEnabled: true,
          },
        });
      } catch (error) {
        thrown = error as { code?: string };
      }

      expect(thrown?.code).toBe('NETWORK_ERROR');
      const state = useCameraStore.getState();
      expect(state.isOffline).toBe(true);
      expect(state.offlineQueue).toHaveLength(1);
      expect(state.offlineQueue[0].type).toBe('add');
      expect((state.offlineQueue[0] as { data?: { name?: string } }).data?.name).toBe('Queued Cam');
      // Persisted so it survives a cold start (not silently dropped)
      expect(await loadOfflineQueue()).toHaveLength(1);
    });

    it('encrypts passwords before they touch the offline queue (AsyncStorage is plaintext)', async () => {
      // Default must resolve a user so encryptQueuedPassword's 2nd getUser
      // (after the Once rejection below) still gets a salt — restoreMocks
      // wipes the factory mock between tests in the full suite.
      (supabase.auth.getUser as jest.Mock)
        .mockResolvedValue({
          data: { user: { id: 'mock-user-id', email: 'test@example.com' } },
          error: null,
        })
        .mockRejectedValueOnce(new TypeError('Network request failed'));

      let thrown: { code?: string } | undefined;
      try {
        await useCameraStore.getState().addCamera({
          name: 'Secure Cam',
          rtspUrl: 'rtsp://192.168.1.51:554/stream',
          username: 'admin',
          password: 'SuperSecret123!',
          isActive: true,
          detectionSettings: {
            person: true,
            vehicle: true,
            face: false,
            sensitivity: 0.7,
            notificationsEnabled: true,
            alarmEnabled: true,
          },
        });
      } catch (error) {
        thrown = error as { code?: string };
      }

      expect(thrown?.code).toBe('NETWORK_ERROR');

      const state = useCameraStore.getState();
      expect(state.offlineQueue).toHaveLength(1);
      const queuedPassword = (
        state.offlineQueue[0] as { data?: { password?: string } }
      ).data?.password;
      expect(queuedPassword).toBeDefined();
      expect(queuedPassword).not.toBe('SuperSecret123!');
      // v2 format: "v2:<base64 iv>:<base64 ciphertext>". The IV is random per
      // encryption, so two encryptions of the same password must differ.
      expect(queuedPassword).toMatch(/^v2:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);

      // Persisted copy must also be encrypted — never raw text on disk
      const persisted = await loadOfflineQueue();
      expect(persisted).toHaveLength(1);
      const persistedPassword = (
        persisted[0] as { data?: { password?: string } }
      ).data?.password;
      expect(persistedPassword).toBeDefined();
      expect(persistedPassword).not.toBe('SuperSecret123!');
      expect(persistedPassword).toMatch(/^v2:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    });

    it('strips the password instead of queueing plaintext when no user id is available', async () => {
      // 1st call: addCamera's auth check (network fail → queue)
      // 2nd call: encryptQueuedPassword's getUser fallback (also fail → try session)
      (supabase.auth.getUser as jest.Mock)
        .mockRejectedValueOnce(new TypeError('Network request failed'))
        .mockRejectedValueOnce(new TypeError('Network request failed'));
      // Ensure any further getUser (shouldn't happen) also fails closed
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: null },
        error: null,
      });
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: null },
        error: null,
      });

      let thrown: { code?: string } | undefined;
      try {
        await useCameraStore.getState().addCamera({
          name: 'No User Cam',
          rtspUrl: 'rtsp://192.168.1.52:554/stream',
          password: 'ShouldNotPersist',
          isActive: true,
          detectionSettings: {
            person: true,
            vehicle: true,
            face: false,
            sensitivity: 0.7,
            notificationsEnabled: true,
            alarmEnabled: true,
          },
        });
      } catch (error) {
        thrown = error as { code?: string };
      }

      expect(thrown?.code).toBe('NETWORK_ERROR');
      const state = useCameraStore.getState();
      expect(state.offlineQueue).toHaveLength(1);
      const queuedPassword = (
        state.offlineQueue[0] as { data?: { password?: string } }
      ).data?.password;
      expect(queuedPassword).toBeUndefined();

      const persisted = await loadOfflineQueue();
      const persistedRaw = JSON.stringify(persisted);
      expect(persistedRaw).not.toContain('ShouldNotPersist');
    });

    it('queues an update when offline instead of dropping it', async () => {
      (supabase.auth.getUser as jest.Mock).mockRejectedValueOnce(
        new TypeError('Network request failed')
      );

      await expect(
        useCameraStore.getState().updateCamera('cam-1', { name: 'New Name' })
      ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });

      const state = useCameraStore.getState();
      expect(state.offlineQueue).toHaveLength(1);
      expect(state.offlineQueue[0].type).toBe('update');
      expect((state.offlineQueue[0] as { id?: string }).id).toBe('cam-1');
      expect((state.offlineQueue[0] as { data?: { name?: string } }).data?.name).toBe('New Name');
    });

    it('queues a delete when offline instead of dropping it', async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockRejectedValue(new TypeError('Network request failed')),
      });

      await expect(
        useCameraStore.getState().deleteCamera('cam-1')
      ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });

      const state = useCameraStore.getState();
      expect(state.isOffline).toBe(true);
      expect(state.offlineQueue).toHaveLength(1);
      expect(state.offlineQueue[0].type).toBe('delete');
      expect((state.offlineQueue[0] as { id?: string }).id).toBe('cam-1');
    });

    it('keeps a failed op queued and retries with backoff', async () => {
      useCameraStore.setState({
        cameras: [createMockCamera({ id: 'cam-1' }), createMockCamera({ id: 'cam-2' })],
      });
      await useCameraStore.getState().queueOfflineOperation({ type: 'delete', id: 'cam-1' });

      const deleteEq = jest.fn().mockRejectedValue(new Error('Network down'));
      (supabase.from as jest.Mock).mockReturnValue({
        delete: jest.fn().mockReturnThis(),
        eq: deleteEq,
      });

      await act(async () => {
        await useCameraStore.getState().processOfflineQueue();
      });

      let state = useCameraStore.getState();
      expect(state.offlineQueue).toHaveLength(1); // op survives the failure
      const op = state.offlineQueue[0] as {
        attempts?: number;
        lastError?: string;
        nextRetryAt?: number;
      };
      expect(op.attempts).toBe(1);
      expect(op.lastError).toBe('Network down');
      expect(op.nextRetryAt!).toBeGreaterThan(Date.now()); // backed off
      expect(state.offlineQueueError).toBeNull(); // quiet during normal backoff
      expect(state.cameras).toHaveLength(2); // nothing dropped or altered
      expect(await loadOfflineQueue()).toHaveLength(1); // persisted for next launch

      // Backoff gate: a second pass before the window opens must NOT re-attempt
      await act(async () => {
        await useCameraStore.getState().processOfflineQueue();
      });
      state = useCameraStore.getState();
      expect(state.offlineQueue).toHaveLength(1);
      expect((state.offlineQueue[0] as { attempts?: number }).attempts).toBe(1);
      expect(deleteEq).toHaveBeenCalledTimes(1); // no premature hammering
    });

    it('drains successfully replayed ops and clears the queue', async () => {
      useCameraStore.setState({
        cameras: [createMockCamera({ id: 'cam-1' }), createMockCamera({ id: 'cam-2' })],
      });
      await useCameraStore.getState().queueOfflineOperation({ type: 'delete', id: 'cam-1' });

      (supabase.from as jest.Mock).mockReturnValue({
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ error: null }),
      });

      await act(async () => {
        await useCameraStore.getState().processOfflineQueue();
      });

      const state = useCameraStore.getState();
      expect(state.offlineQueue).toEqual([]);
      expect(state.offlineQueueError).toBeNull();
      expect(state.cameras.map((c) => c.id)).toEqual(['cam-2']);
      expect(await loadOfflineQueue()).toEqual([]); // persisted key removed
    });

    it('surfaces offlineQueueError after retries exhaust without dropping data', async () => {
      const exhaustedOp = {
        type: 'delete' as const,
        id: 'cam-1',
        timestamp: Date.now(),
        attempts: OFFLINE_QUEUE_RETRY.maxAttempts,
        lastError: 'Network down',
        nextRetryAt: Date.now() - 1000, // backoff window already open
      };
      useCameraStore.setState({ offlineQueue: [exhaustedOp] });

      (supabase.from as jest.Mock).mockReturnValue({
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockRejectedValue(new Error('Network down')),
      });

      await act(async () => {
        await useCameraStore.getState().processOfflineQueue();
      });

      let state = useCameraStore.getState();
      expect(state.offlineQueue).toHaveLength(1); // data kept, never dropped
      expect((state.offlineQueue[0] as { attempts?: number }).attempts).toBe(
        OFFLINE_QUEUE_RETRY.maxAttempts
      ); // no infinite retry spam
      expect(state.offlineQueueError).toBe('Network down'); // failure is visible
      expect(await loadOfflineQueue()).toHaveLength(1);

      // Once connectivity returns the op succeeds → error + queue clear
      (supabase.from as jest.Mock).mockReturnValue({
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ error: null }),
      });
      useCameraStore.setState({
        offlineQueue: [{ ...exhaustedOp, nextRetryAt: Date.now() - 1000 }],
      });

      await act(async () => {
        await useCameraStore.getState().processOfflineQueue();
      });

      state = useCameraStore.getState();
      expect(state.offlineQueue).toEqual([]);
      expect(state.offlineQueueError).toBeNull();
    });

    it('does not duplicate a mutation when a replay fails again', async () => {
      useCameraStore.setState({
        cameras: [createMockCamera({ id: 'cam-1' })],
      });
      await useCameraStore.getState().queueOfflineOperation({ type: 'delete', id: 'cam-1' });

      (supabase.from as jest.Mock).mockReturnValue({
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockRejectedValue(new TypeError('Network request failed')),
      });

      await act(async () => {
        await useCameraStore.getState().processOfflineQueue();
      });

      const state = useCameraStore.getState();
      expect(state.offlineQueue).toHaveLength(1); // still just the one op
      expect(state.offlineQueue[0].type).toBe('delete');
      expect((state.offlineQueue[0] as { attempts?: number }).attempts).toBe(1);
    });
  });

  // =========================================================================
  // credential sanitization (rtsp_url never carries user:pass@)
  // =========================================================================
  describe('credential sanitization', () => {
    it('fetchCameras strips embedded credentials and back-writes the clean URL', async () => {
      const mockCameraData = {
        id: 'cam-1',
        user_id: 'user-1',
        name: 'Legacy',
        rtsp_url: 'rtsp://admin:secret@192.168.1.50:554/stream',
        username: 'admin',
        password: 'encrypted',
        is_active: true,
        thumbnail_url: null,
        detection_settings: { person: true, vehicle: true },
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      const updateMock = jest.fn().mockReturnThis();
      const eqMock = jest.fn().mockResolvedValue({ error: null });
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'cameras') {
          return {
            select: jest.fn().mockReturnThis(),
            order: jest.fn().mockResolvedValue({
              data: [mockCameraData],
              error: null,
            }),
            update: updateMock,
            eq: eqMock,
          };
        }
        return { select: jest.fn().mockReturnThis() };
      });

      await act(async () => {
        await useCameraStore.getState().fetchCameras();
      });

      const state = useCameraStore.getState();
      expect(state.cameras[0].rtspUrl).toBe('rtsp://192.168.1.50:554/stream');
      expect(state.cameras[0].rtspUrl).not.toContain('secret');

      // Self-heal: legacy DB row is rewritten without credentials
      expect(updateMock).toHaveBeenCalledWith({
        rtsp_url: 'rtsp://192.168.1.50:554/stream',
        updated_at: expect.any(String),
      });
      expect(eqMock).toHaveBeenCalledWith('id', 'cam-1');
    });

    it('addCamera strips credentials before insert, cache, and state', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null,
      });
      // Re-establish global fetch in case restoreMocks cleared it
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });

      const insertMock = jest.fn().mockReturnThis();
      const singleMock = jest.fn().mockResolvedValue({
        data: {
          id: 'new-cam',
          user_id: 'user-1',
          name: 'Cam',
          rtsp_url: 'rtsp://192.168.1.50:554/stream',
          is_active: true,
          detection_settings: { person: true, vehicle: true },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        error: null,
      });

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: { subscription_tier: 'pro' },
              error: null,
            }),
          };
        }
        return {
          insert: insertMock,
          select: jest.fn().mockReturnThis(),
          // Quota check: head/count query resolving on eq().
          eq: jest.fn().mockResolvedValue({ count: 0, error: null }),
          single: singleMock,
        };
      });

      (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });

      await act(async () => {
        await useCameraStore.getState().addCamera({
          name: 'Cam',
          rtspUrl: 'rtsp://admin:hunter2@192.168.1.50:554/stream',
          username: 'admin',
          password: 'hunter2',
          isActive: true,
          detectionSettings: {
            person: true,
            vehicle: true,
            face: false,
            sensitivity: 0.7,
            notificationsEnabled: true,
            alarmEnabled: true,
          },
        });
      });

      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({ rtsp_url: 'rtsp://192.168.1.50:554/stream' })
      );
      const stored = useCameraStore.getState().cameras[0];
      expect(stored.rtspUrl).toBe('rtsp://192.168.1.50:554/stream');
      expect(stored.rtspUrl).not.toContain('hunter2');
    });

    it('updateCamera strips credentials in the DB write and in state', async () => {
      useCameraStore.setState({
        cameras: [createMockCamera({ id: 'cam-1' })],
      });

      const updateMock = jest.fn().mockReturnThis();
      const eqMock = jest.fn().mockResolvedValue({ error: null });
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null,
      });
      (supabase.from as jest.Mock).mockReturnValue({ update: updateMock, eq: eqMock });

      await act(async () => {
        await useCameraStore.getState().updateCamera('cam-1', {
          rtspUrl: 'rtsp://admin:secret@10.0.0.7:554/stream',
        });
      });

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({ rtsp_url: 'rtsp://10.0.0.7:554/stream' })
      );
      const stored = useCameraStore.getState().cameras[0];
      expect(stored.rtspUrl).toBe('rtsp://10.0.0.7:554/stream');
      expect(stored.rtspUrl).not.toContain('secret');
    });
  });
});

