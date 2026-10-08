import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useEffect,
  useState,
} from 'react';
import {
  Alert,
  AppState,
  type AppStateStatus,
  Clipboard,
  LogBox,
} from 'react-native';

// Ignore specific warnings that are expected in Expo Go
LogBox.ignoreLogs([
  'expo-notifications: Android Push notifications',
  '[expo-notifications]',
]);
import { AppLockOverlay } from '@/components/security/AppLockOverlay';
import { adMobService } from '@/lib/ads/adMobService';
import { consentManager } from '@/lib/ads/consentManager';
import { borderRadius, colors, fontSize, spacing } from '@/lib/theme';
import { logError } from '@/lib/utils/cn';
import { useAlertStore, useAuthStore } from '@/stores';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

// Conditionally import Sentry if available
let Sentry: any = null;
try {
  Sentry = require('@sentry/react-native');
} catch (_error) {
  console.warn('[Sentry] Not installed - error tracking disabled');
}

// Error Boundary Component to catch crashes
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log the full error + component stack. This is the single most useful
    // line of diagnostics when a boundary trips on device, and Sentry is not
    // always configured in a sideload build.
    console.error(
      'App Error:',
      error?.message,
      error?.stack,
      errorInfo?.componentStack,
    );
    console.log(
      'App Error Boundary:',
      JSON.stringify(
        {
          message: error?.message,
          name: error?.name,
          stack: error?.stack,
        },
        null,
        2,
      ),
    );

    // Log to Sentry if configured
    if (Sentry?.getCurrentHub?.().getClient()) {
      Sentry.captureException(error, {
        contexts: {
          react: {
            componentStack: errorInfo.componentStack,
          },
        },
        tags: {
          errorBoundary: 'root',
        },
      });
    }

    // Log to custom error handler
    logError(error, 'ErrorBoundary.root');

    // Auto-copy the details so a crash on a sideload build is diagnosable even
    // if the user never taps "Report Issue". Best-effort: a clipboard failure
    // must not mask the original error.
    try {
      Clipboard.setString(
        `Error: ${error?.message}\nName: ${error?.name}\nStack: ${error?.stack}\nComponent: ${errorInfo?.componentStack}\nTime: ${new Date().toISOString()}`,
      );
    } catch {
      // ignore clipboard errors
    }
  }

  handleRestart = () => {
    this.setState({ hasError: false, error: null });
  };

  handleReportIssue = () => {
    if (this.state.error) {
      this.copyDetails();
      Alert.alert(
        'Error Copied',
        'Error details have been copied to clipboard. Please send to support.',
        [{ text: 'OK' }],
      );
    }
  };

  copyDetails = () => {
    if (!this.state.error) return;
    const errorDetails = `
Error: ${this.state.error.message}
Stack: ${this.state.error.stack}
Time: ${new Date().toISOString()}
    `.trim();
    Clipboard.setString(errorDetails);
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={errorStyles.container}>
          <Text style={errorStyles.title}>Something went wrong</Text>
          <Text style={errorStyles.message} selectable>
            {this.state.error?.message || 'An unexpected error occurred'}
          </Text>
          <View style={errorStyles.buttonContainer}>
            <TouchableOpacity
              style={errorStyles.button}
              onPress={this.handleRestart}
            >
              <Text style={errorStyles.buttonText}>Try Again</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[errorStyles.button, errorStyles.secondaryButton]}
              onPress={this.handleReportIssue}
            >
              <Text style={errorStyles.buttonText}>Report Issue</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }
    return this.props.children;
  }
}

const errorStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.primary,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  title: {
    fontSize: fontSize['2xl'],
    fontWeight: '700',
    color: colors.text.primary,
    marginBottom: spacing.md,
  },
  message: {
    fontSize: fontSize.base,
    color: colors.text.secondary,
    textAlign: 'center',
    marginBottom: spacing.xxl,
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  button: {
    backgroundColor: colors.brand.red,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
    borderRadius: borderRadius.lg,
  },
  secondaryButton: {
    backgroundColor: colors.bg.secondary,
  },
  buttonText: {
    fontSize: fontSize.base,
    fontWeight: '600',
    color: colors.text.primary,
  },
});

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 2,
    },
  },
});

import { useAdEntitlementSync } from '@/hooks/useAdEntitlement';
import { useDetectionCoordinator } from '@/hooks/useDetectionCoordinator';
import { initializeEncryption } from '@/lib/crypto';
import { ensureNotificationChannels } from '@/lib/notifications/service';
import { refreshMediaEdgeHealth } from '@/lib/streaming/mediaServerHealth';
import { useAutomationStore } from '@/stores/automationStore';

function DetectionWatcher() {
  useDetectionCoordinator();
  return null;
}

function AdEntitlementWatcher() {
  // Pushes the subscription tier into adMobService so premium subscribers stop
  // seeing ads. Mounted at the root so it stays correct across purchase,
  // restore, downgrade and expiry.
  useAdEntitlementSync();
  return null;
}

function AutomationWatcher() {
  const fetchAutomations = useAutomationStore((s) => s.fetchAutomations);
  const checkAutomations = useAutomationStore((s) => s.checkAutomations);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (!isAuthenticated) return;
    void fetchAutomations();
    const id = setInterval(() => {
      void checkAutomations();
    }, 60_000);
    void checkAutomations();
    return () => clearInterval(id);
  }, [fetchAutomations, checkAutomations, isAuthenticated]);

  return null;
}

export default function RootLayout() {
  const initialize = useAuthStore((state) => state.initialize);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const subscribeToAlerts = useAlertStore((state) => state.subscribeToAlerts);
  const [appReady, setAppReady] = useState(false);
  const [appState, setAppState] = useState<AppStateStatus>(
    AppState.currentState,
  );

  useEffect(() => {
    const init = async () => {
      try {
        // Create a safety timeout promise
        const timeoutPromise = new Promise<void>((resolve) => {
          setTimeout(() => {
            console.warn('App initialization timed out - forcing load');
            resolve();
          }, 7000); // 7 seconds max wait time
        });

        // The actual initialization logic
        const initPromise = (async () => {
          // Encryption key must be loaded before any camera credential is read
          // or written. Previously the key was read from an EXPO_PUBLIC_ env
          // var, which means it shipped inside the bundle and was extractable.
          await initializeEncryption();

          // Create the Android notification channel. On Android 8+ an alert
          // posted to a channel that does not exist is silently dropped, so
          // this must happen before the first notification, not on first push
          // registration.
          await ensureNotificationChannels();

          // Initialize auth and wait for completion
          await initialize();

          // Bring up the subscription service so Play Billing availability is
          // resolved before the user ever opens the paywall.
          //
          // This was never called anywhere, and `playBillingAvailable` is only
          // ever set by `initPlayBilling()` inside this method -- so
          // `getAvailableProviders()` filtered out `google_play` forever and
          // the Google Play option could never appear, even once a RevenueCat
          // key was configured. Fire and forget so a slow network cannot block
          // startup; the paywall re-reads the provider list when it opens.
          void (async () => {
            try {
              const { subscriptionService } = await import(
                '@/lib/subscription/subscriptionService'
              );
              await subscriptionService.initialize();
            } catch (subError) {
              console.error('[Subscription] Background init failed:', subError);
            }
          })();

          // Probe media edge in background
          void refreshMediaEdgeHealth();

          // Initialize AdMob and Consent Manager in background (non-blocking)
          // Fire and forget - don't block app startup
          (async () => {
            try {
              const consented = await consentManager.requestConsent();
              // Do not initialise the ad SDK without a resolved consent state:
              // on an error the consent request returns false, and initialising
              // anyway serves personalised ads to EEA users with no consent.
              if (!consented) {
                console.log('[AdMob] Skipping init - no resolved ad consent');
                adMobService.setConsentGranted(false);
                return;
              }
              // `consented` is only true for OBTAINED / NOT_REQUIRED, so it is
              // exactly the "personalised ads permitted" signal. Without this,
              // every ad request was made with non-personalized flag hard-coded
              // to false regardless of what the user chose.
              adMobService.setConsentGranted(true);
              await adMobService.initialize();
              console.log('[AdMob] Initialized in background');
            } catch (adError) {
              console.error('[AdMob] Background init failed:', adError);
            }
          })();
        })();

        // Race the initialization against the safety timeout
        await Promise.race([initPromise, timeoutPromise]);
      } catch (error) {
        console.error('Initialization error:', error);
      } finally {
        // Small delay to ensure state is settled
        await new Promise((resolve) => setTimeout(resolve, 100));
        setAppReady(true);
        // Hide splash screen only when truly ready
        await SplashScreen.hideAsync().catch((err) =>
          console.warn('Splash hide error:', err),
        );
      }
    };
    init();
  }, [initialize]);

  // Handle app state changes (foreground/background)
  // Note: Cleanup handlers simplified to avoid module resolution issues in Expo Go
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only or stable store refs
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      console.log('[AppState] Changed from', appState, 'to', nextAppState);

      if (appState.match(/inactive|background/) && nextAppState === 'active') {
        // App came to foreground - refresh auth session
        console.log('[AppState] App came to foreground');
        initialize().catch((err) =>
          console.warn('[AppState] Foreground init error:', err),
        );

        // Deliberately NOT re-subscribing here. The realtime channel below is
        // owned for the lifetime of the authenticated session and the socket
        // reconnects on its own. Calling subscribeToAlerts() on every
        // foreground leaked a new 'alerts-realtime' channel each time (the
        // unsubscribe was discarded), and duplicate topics are what made
        // Supabase reject the postgres_changes binding.
      }
      // Note: Background cleanup removed to avoid Expo Go module errors
      // In production builds, this would stop camera streams and detection

      setAppState(nextAppState);
    });

    return () => {
      subscription.remove();
    };
  }, [appState, isAuthenticated, initialize]);

  // Subscribe to real-time alerts when authenticated
  useEffect(() => {
    if (isAuthenticated && appReady) {
      const unsubscribe = subscribeToAlerts();
      return () => {
        unsubscribe();
      };
    }
  }, [isAuthenticated, appReady, subscribeToAlerts]);

  // Show loading screen ONLY during initial app load
  // Do NOT depend on isLoading from auth store - that causes blinking
  if (!appReady) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.bg.primary,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator size="large" color={colors.brand.red} />
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="light" />
          <DetectionWatcher />
          <AdEntitlementWatcher />
          <AutomationWatcher />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: '#0F172A' },
              animation: 'slide_from_right',
            }}
          />
          {/* Rendered last so it paints above every route. */}
          <AppLockOverlay />
        </QueryClientProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
