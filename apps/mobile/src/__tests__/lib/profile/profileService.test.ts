/**
 * profileService.deleteAccount — must route its sign-out through the auth
 * store so the shared-device camera cache wipe actually runs.
 */

import {
  CAMERAS_CACHE_KEY,
  clearCameraCache,
  saveCamerasCache,
} from '@/lib/camera/cameraCache';
import { profileService } from '@/lib/profile/profileService';
import { supabase } from '@/lib/supabase/client';
import { useAuthStore } from '@/stores/authStore';
import { useCameraStore } from '@/stores/cameraStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createMockCamera } from '../../setup';

jest.mock('@/lib/supabase/client', () => ({
  isSupabaseConfigured: true,
  supabase: {
    supabaseUrl: 'https://mock.supabase.co',
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'user-a', email: 'a@example.com' } },
        error: null,
      }),
      signOut: jest.fn().mockResolvedValue({ error: null }),
      getSession: jest
        .fn()
        .mockResolvedValue({ data: { session: null }, error: null }),
    },
    rpc: jest.fn().mockResolvedValue({
      data: { success: true, deleted_storage_objects: 3 },
      error: null,
    }),
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

describe('profileService.deleteAccount', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    useCameraStore.getState().reset();
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
    await clearCameraCache();
    await AsyncStorage.removeItem('auth-storage');
  });

  it('signs out through the auth store so the camera cache is wiped', async () => {
    // User A has cameras cached on this device
    const camera = createMockCamera({ id: 'cam-a', userId: 'user-a' });
    await saveCamerasCache([camera]);
    expect(await AsyncStorage.getItem(CAMERAS_CACHE_KEY)).toBeTruthy();

    // deleteAccount must sign out THROUGH the auth store, not behind its back,
    // so the shared-device cleanup (auth state + camera cache) actually runs.
    const signOutSpy = jest.spyOn(useAuthStore.getState(), 'signOut');

    const ok = await profileService.deleteAccount();

    expect(ok).toBe(true);
    expect(signOutSpy).toHaveBeenCalled();
    // auth state cleared via the store
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    // camera cache wiped (list incl. RTSP URLs)
    expect(await AsyncStorage.getItem(CAMERAS_CACHE_KEY)).toBeNull();
    expect(useCameraStore.getState().cameras).toEqual([]);
  });

  it('reports failure instead of signing out when the delete RPC refuses', async () => {
    // The bug this guards against: deletion used to be a DELETE on profiles,
    // which RLS rejected, and the function reported success anyway. If
    // delete_account() does not return success, the caller must not be told the
    // account is gone.
    (supabase.rpc as jest.Mock).mockResolvedValueOnce({
      data: { success: false, error: 'user_not_found' },
      error: null,
    });
    const signOutSpy = jest.spyOn(useAuthStore.getState(), 'signOut');

    const ok = await profileService.deleteAccount();

    expect(ok).toBe(false);
    expect(signOutSpy).not.toHaveBeenCalled();
  });

  it('reports failure when the delete RPC errors', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValueOnce({
      data: null,
      error: { message: 'permission denied for function delete_account' },
    });
    const signOutSpy = jest.spyOn(useAuthStore.getState(), 'signOut');

    const ok = await profileService.deleteAccount();

    expect(ok).toBe(false);
    expect(signOutSpy).not.toHaveBeenCalled();
  });
});
