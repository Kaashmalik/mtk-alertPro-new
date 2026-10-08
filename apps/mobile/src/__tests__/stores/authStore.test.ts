/**
 * Auth Store Tests — sign-out must wipe the camera cache so a shared device
 * never lets User B hydrate User A's cameras / RTSP URLs.
 */

import {
  CAMERAS_CACHE_KEY,
  HEALTH_CACHE_KEY,
  OFFLINE_QUEUE_KEY,
  clearCameraCache,
  saveCamerasCache,
  saveHealthCache,
} from '@/lib/camera/cameraCache';
import type { CameraHealth } from '@/lib/camera/connectionService';
import { supabase } from '@/lib/supabase/client';
import { useAuthStore } from '@/stores/authStore';
import { useCameraStore } from '@/stores/cameraStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
// `act` from react — avoids monorepo react-test-renderer@19 vs react@18 mismatch
import { act } from 'react';
import { createMockCamera } from '../setup';

// Session backing the mocked Supabase client — flips between User A / User B
// across a test to simulate two people sharing one device.
let mockCurrentUser: { id: string; email: string } | null = null;

jest.mock('@/lib/supabase/client', () => ({
  isSupabaseConfigured: true,
  supabase: {
    supabaseUrl: 'https://mock.supabase.co',
    auth: {
      getSession: jest.fn().mockImplementation(async () => ({
        data: { session: mockCurrentUser ? { user: mockCurrentUser } : null },
        error: null,
      })),
      getUser: jest.fn().mockImplementation(async () => ({
        data: { user: mockCurrentUser },
        error: null,
      })),
      signInWithPassword: jest.fn().mockImplementation(async () => {
        if (!mockCurrentUser) {
          return { data: { session: null }, error: null };
        }
        return { data: { session: { user: mockCurrentUser } }, error: null };
      }),
      signOut: jest.fn().mockResolvedValue({ error: null }),
      onAuthStateChange: jest.fn().mockReturnValue({
        data: { subscription: { unsubscribe: jest.fn() } },
      }),
    },
    from: jest.fn((table: string) => {
      if (table === 'profiles') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      return {
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
      };
    }),
  },
}));

/** Camera + health that belong to "User A" on a shared device */
function makeUserAData() {
  const camera = createMockCamera({
    id: 'cam-a',
    userId: 'user-a',
    name: 'A Front Door',
    rtspUrl: 'rtsp://192.168.1.50:554/stream',
  });
  const health: CameraHealth = {
    cameraId: 'cam-a',
    status: 'online',
    isOnline: true,
    avgLatency: 42,
    lastOnline: new Date(),
    lastChecked: new Date(),
    failureCount: 0,
    lastTest: { success: true, latency: 42, timestamp: new Date() },
  };
  return { camera, health };
}

/** Seed "User A has cameras cached": AsyncStorage + in-memory store state. */
async function seedUserACache() {
  const { camera, health } = makeUserAData();
  await saveCamerasCache([camera]);
  await saveHealthCache({ 'cam-a': health });
  useCameraStore.setState({
    cameras: [camera],
    selectedCamera: camera,
    cameraHealth: { 'cam-a': health },
    connectionTests: {
      'cam-a': { success: true, latency: 42, timestamp: new Date() },
    },
    isHydrated: true,
  });
}

/** Mock the `profiles` fetch so sign-in resolves to a specific user. */
function mockProfile(user: { id: string; email: string }) {
  (supabase.from as jest.Mock).mockImplementation((table: string) => {
    if (table === 'profiles') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: {
            id: user.id,
            email: user.email,
            display_name: 'User',
            avatar_url: null,
            subscription_tier: 'free',
            subscription_expires_at: null,
            fcm_token: null,
          },
          error: null,
        }),
      };
    }
    return {
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
  });
}

describe('Auth Store — sign-out cache cleanup', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockCurrentUser = null;
    useCameraStore.getState().reset();
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
    await clearCameraCache();
    await AsyncStorage.removeItem('auth-storage');
    await AsyncStorage.removeItem('biometric-user-email');
  });

  it('wipes User A camera cache on sign-out so User B starts clean', async () => {
    // ---- User A has cameras cached (AsyncStorage + in-memory store) ----
    await seedUserACache();
    expect(await AsyncStorage.getItem(CAMERAS_CACHE_KEY)).toBeTruthy();
    expect(await AsyncStorage.getItem(HEALTH_CACHE_KEY)).toBeTruthy();
    expect(useCameraStore.getState().cameras).toHaveLength(1);

    // ---- User A signs out ----
    mockCurrentUser = { id: 'user-a', email: 'a@example.com' };
    await act(async () => {
      await useAuthStore.getState().signOut();
    });

    // Auth state cleared
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);

    // In-memory camera state completely wiped
    expect(useCameraStore.getState().cameras).toEqual([]);
    expect(useCameraStore.getState().selectedCamera).toBeNull();
    expect(useCameraStore.getState().cameraHealth).toEqual({});
    expect(useCameraStore.getState().connectionTests).toEqual({});
    expect(useCameraStore.getState().offlineQueue).toEqual([]);
    expect(useCameraStore.getState().isHydrated).toBe(false);

    // AsyncStorage camera caches removed (list incl. RTSP URLs, health, queue)
    expect(await AsyncStorage.getItem(CAMERAS_CACHE_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(HEALTH_CACHE_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(OFFLINE_QUEUE_KEY)).toBeNull();

    // ---- User B signs in on the same device ----
    mockCurrentUser = { id: 'user-b', email: 'b@example.com' };
    mockProfile(mockCurrentUser);
    await act(async () => {
      await useAuthStore
        .getState()
        .signInWithEmail('b@example.com', 'password');
    });

    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().user?.id).toBe('user-b');

    // User B's session shows ZERO leftover cameras/data from User A
    expect(useCameraStore.getState().cameras).toEqual([]);
    expect(useCameraStore.getState().selectedCamera).toBeNull();
    expect(useCameraStore.getState().cameraHealth).toEqual({});

    // Even a cold-start hydration cannot resurrect User A's cameras
    await act(async () => {
      await useCameraStore.getState().hydrateFromCache();
    });
    expect(useCameraStore.getState().cameras).toEqual([]);
    expect(await AsyncStorage.getItem(CAMERAS_CACHE_KEY)).toBeNull();
  });

  it('wipes camera cache on a supabase-driven SIGNED_OUT event', async () => {
    await seedUserACache();
    mockCurrentUser = { id: 'user-a', email: 'a@example.com' };

    // Mount the auth-state listener so we can fire a server-side sign-out
    const unsubscribe = useAuthStore.getState().setupTokenRefresh();
    const listener = (supabase.auth.onAuthStateChange as jest.Mock).mock
      .calls[0][0];

    await act(async () => {
      await listener('SIGNED_OUT', null);
    });

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useCameraStore.getState().cameras).toEqual([]);
    expect(useCameraStore.getState().cameraHealth).toEqual({});
    expect(await AsyncStorage.getItem(CAMERAS_CACHE_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(HEALTH_CACHE_KEY)).toBeNull();

    unsubscribe();
  });
});
