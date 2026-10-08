import { getConfirmRedirectUrl } from '@/lib/auth/confirmRedirect';
import { disableBiometricAuth } from '@/lib/biometric';
import {
  isSupabaseConfigured,
  supabase,
  supabaseUrl,
} from '@/lib/supabase/client';
import type { User } from '@/types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useCameraStore } from './cameraStore';

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;

  initialize: () => Promise<void>;
  setupTokenRefresh: () => () => void;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (
    email: string,
    password: string,
    displayName?: string,
  ) => Promise<void>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<User>) => Promise<void>;
  refreshUser: () => Promise<void>;
  clearError: () => void;
}

const isPlaceholderConfig = () => {
  const url =
    (supabase as unknown as { supabaseUrl?: string }).supabaseUrl ??
    supabaseUrl;
  return (
    !isSupabaseConfigured ||
    url?.includes('your-project') ||
    url?.includes('example.com')
  );
};

const withTimeout = <T>(
  promise: Promise<T>,
  ms = 8000,
  message = 'Request timed out',
): Promise<T> => {
  // The timer handle has to be retained and cleared. Racing a bare
  // setTimeout() leaves the handle armed for the full duration even after the
  // real request resolves, which keeps the event loop (and the jest worker
  // process) alive for no reason. finally() clears it on both outcomes.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isLoading: true,
      isAuthenticated: false,
      error: null,

      initialize: async () => {
        try {
          // Check if Supabase is properly configured
          if (!isSupabaseConfigured) {
            console.warn(
              'Supabase not configured - skipping auth initialization',
            );
            set({ isLoading: false, error: null });
            return;
          }

          // Add timeout to session fetch to prevent hanging. Routed through the
          // shared helper so the timer is cleared once the fetch settles,
          // instead of staying armed for the full 5s behind every signed-in user.
          const {
            data: { session },
            error: sessionError,
          } = await withTimeout(
            supabase.auth.getSession() as Promise<{
              data: { session: any };
              error: any;
            }>,
            5000,
            'Auth session fetch timed out',
          ).catch((err) => {
            console.warn('Auth session race error:', err);
            return { data: { session: null }, error: err } as {
              data: { session: any };
              error: any;
            };
          });

          if (sessionError) {
            console.warn('Session error:', sessionError.message);
            set({ isLoading: false, error: null });
            return;
          }

          if (session?.user) {
            const { data: profile, error: profileError } = await supabase
              .from('profiles')
              .select('*')
              .eq('id', session.user.id)
              .single();

            if (profileError) {
              // Profile might not exist yet - that's OK
              console.warn('Profile fetch error:', profileError.message);
              // Still mark as authenticated with basic user data
              set({
                user: {
                  id: session.user.id,
                  email: session.user.email || '',
                  displayName:
                    session.user.user_metadata?.display_name ||
                    session.user.email?.split('@')[0] ||
                    'User',
                  avatarUrl: session.user.user_metadata?.avatar_url || null,
                  subscriptionTier: 'free',
                  subscriptionExpiresAt: null,
                  fcmToken: null,
                },
                isAuthenticated: true,
                isLoading: false,
              });
              return;
            }

            if (profile) {
              set({
                user: {
                  id: profile.id,
                  email: profile.email,
                  displayName: profile.display_name,
                  avatarUrl: profile.avatar_url,
                  subscriptionTier: profile.subscription_tier as
                    | 'free'
                    | 'pro'
                    | 'business',
                  subscriptionExpiresAt: profile.subscription_expires_at
                    ? new Date(profile.subscription_expires_at)
                    : null,
                  fcmToken: profile.fcm_token,
                },
                isAuthenticated: true,
              });
            }
          }
        } catch (error) {
          console.error('Auth initialization error:', error);
          // Don't crash - just mark as not authenticated
          set({
            error:
              error instanceof Error ? error.message : 'Initialization failed',
          });
        } finally {
          set({ isLoading: false });
        }
      },

      signInWithEmail: async (email, password) => {
        set({ isLoading: true, error: null });
        try {
          if (isPlaceholderConfig()) {
            throw new Error(
              'Please configure a valid Supabase URL to sign in.',
            );
          }

          const { data, error } = await withTimeout(
            supabase.auth.signInWithPassword({
              email,
              password,
            }),
            8000,
            'Login timed out. Check your internet connection or Supabase configuration.',
          );

          if (error) {
            // Handle specific error cases
            if (error.message.includes('Invalid login credentials')) {
              throw new Error('Invalid email or password');
            }
            if (error.message.includes('Email not confirmed')) {
              throw new Error('Please verify your email before signing in');
            }
            if (
              error.message.includes('FetchError') ||
              error.message.includes('Network request failed')
            ) {
              throw new Error('Network error. Unable to reach the server.');
            }
            throw error;
          }

          if (!data.session) {
            throw new Error('Login failed - no session created');
          }

          await get().initialize();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Login failed';
          set({ error: message });
          throw error;
        } finally {
          set({ isLoading: false });
        }
      },

      signUpWithEmail: async (email, password, displayName) => {
        set({ isLoading: true, error: null });
        try {
          if (isPlaceholderConfig()) {
            throw new Error(
              'Please configure a valid Supabase URL to register.',
            );
          }

          const { data, error } = await withTimeout(
            supabase.auth.signUp({
              email,
              password,
              options: {
                // Send the confirmation to the web confirm page so the link
                // opens a real page in the browser instead of a dead localhost
                // URL. See lib/auth/confirmRedirect for the dashboard settings
                // this must be registered under.
                emailRedirectTo: getConfirmRedirectUrl(),
                data: {
                  display_name: displayName || email.split('@')[0],
                },
              },
            }),
            8000,
            'Registration timed out. Check your internet connection or Supabase configuration.',
          );

          if (error) throw error;

          // Check if email confirmation is required
          // Don't auto-login - user needs to verify email first
          if (data?.user && !data.session) {
            // Email confirmation required - don't navigate, show success message
            console.log('Email confirmation required');
            set({ isLoading: false });
            return;
          }

          // If session exists (email confirmation disabled), initialize
          if (data?.session) {
            await get().initialize();
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Registration failed';
          set({ error: message });
          throw error;
        } finally {
          set({ isLoading: false });
        }
      },

      signOut: async () => {
        set({ isLoading: true });
        try {
          // Sign out from Supabase
          await supabase.auth.signOut();
        } catch (error) {
          console.error('Supabase sign out error:', error);
          // Continue with local cleanup even if server signout fails
        }

        try {
          // Clear persisted auth state
          await AsyncStorage.removeItem('auth-storage');
          // Clear SecureStore biometric keys (user email + enabled flag) so the
          // next user on this device can never unlock the previous user's account
          await disableBiometricAuth();
        } catch (error) {
          console.error('Storage cleanup error:', error);
        }

        // 🔒 Wipe the camera cache (list, RTSP URLs, health, offline queue,
        // in-memory state) so the next user on this device can never hydrate
        // the signed-out user's cameras from AsyncStorage or store state.
        try {
          await useCameraStore.getState().clearCache();
        } catch (error) {
          console.error('Camera cache cleanup error:', error);
        }

        // Always clear local state
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          error: null,
        });
      },

      updateProfile: async (updates) => {
        const user = get().user;
        if (!user) return;

        const { error } = await supabase
          .from('profiles')
          .update({
            display_name: updates.displayName,
            avatar_url: updates.avatarUrl,
          })
          .eq('id', user.id);

        if (error) throw error;
        set({ user: { ...user, ...updates } });
      },

      refreshUser: async () => {
        const user = get().user;
        if (!user) return;

        try {
          const { data: profile, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();

          if (error) {
            console.error('Failed to refresh user profile:', error);
            return;
          }

          if (profile) {
            set({
              user: {
                id: profile.id,
                email: profile.email,
                displayName: profile.display_name,
                avatarUrl: profile.avatar_url,
                subscriptionTier: profile.subscription_tier as
                  | 'free'
                  | 'pro'
                  | 'business',
                subscriptionExpiresAt: profile.subscription_expires_at
                  ? new Date(profile.subscription_expires_at)
                  : null,
                fcmToken: profile.fcm_token,
              },
            });
          }
        } catch (error) {
          console.error('Error refreshing user:', error);
        }
      },

      clearError: () => {
        set({ error: null });
      },

      setupTokenRefresh: () => {
        let refreshFailureCount = 0;
        const MAX_REFRESH_FAILURES = 3;

        const {
          data: { subscription },
        } = supabase.auth.onAuthStateChange(async (event, session) => {
          console.log(
            '[AuthStore] Auth state changed:',
            event,
            'has session:',
            !!session,
          );

          if (event === 'TOKEN_REFRESHED') {
            if (session?.user) {
              console.log('[AuthStore] Token refreshed successfully');
              refreshFailureCount = 0; // Reset failure count on success
              await get().refreshUser();
            } else {
              // Token refresh failed - no session after refresh event
              console.error('[AuthStore] Token refresh failed - no session');
              refreshFailureCount++;

              if (refreshFailureCount >= MAX_REFRESH_FAILURES) {
                console.error(
                  '[AuthStore] Max refresh failures reached - forcing logout',
                );
                await get().signOut();
                set({
                  error: 'Session expired. Please sign in again.',
                });
              }
            }
          } else if (event === 'SIGNED_OUT') {
            console.log('[AuthStore] User signed out');
            // Wipe camera cache/state on ANY supabase-driven sign-out
            // (session expiry, account deletion, remote sign-out) so no
            // leftover data survives for the next user on this device.
            try {
              await useCameraStore.getState().clearCache();
            } catch (error) {
              console.error('Camera cache cleanup error:', error);
            }
            set({
              user: null,
              isAuthenticated: false,
              isLoading: false,
              error: null,
            });
            refreshFailureCount = 0;
          } else if (event === 'USER_UPDATED') {
            console.log('[AuthStore] User updated');
            refreshFailureCount = 0;

            if (session?.user) {
              await get().refreshUser();
            }
          }
        });

        return () => {
          subscription.unsubscribe();
        };
      },
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ user: state.user }),
    },
  ),
);
