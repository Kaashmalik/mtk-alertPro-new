import * as LocalAuthentication from 'expo-local-authentication';
import { Fingerprint, Lock, ScanFace } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  type AppStateStatus,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { isBiometricEnabled } from '@/lib/biometric';
import { useAuthStore } from '@/stores';
import { designSystem } from '@/theme/design-system';

/**
 * Full-screen lock shown when the app returns to the foreground and the user
 * has opted into biometric login.
 *
 * Deliberately NOT shown on first launch: a user who just authenticated with
 * biometrics on the login screen would otherwise be asked to authenticate
 * again immediately. The lock engages only after the app has left the
 * foreground at least once.
 */
export function AppLockOverlay() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [locked, setLocked] = useState(false);
  const [failed, setFailed] = useState(false);
  const [promptAttempt, setPromptAttempt] = useState(0);
  const promptingRef = useRef(false);
  const leftForegroundRef = useRef(false);

  // Decide whether to lock whenever the app returns to the foreground.
  useEffect(() => {
    if (!isAuthenticated) {
      setLocked(false);
      leftForegroundRef.current = false;
      return;
    }

    const handleChange = (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') {
        leftForegroundRef.current = true;
        return;
      }
      if (next === 'active' && leftForegroundRef.current) {
        leftForegroundRef.current = false;
        void (async () => {
          try {
            if (await isBiometricEnabled()) {
              setFailed(false);
              setLocked(true);
            }
          } catch {
            // If the flag cannot be read, do not trap the user.
            setLocked(false);
          }
        })();
      }
    };

    const sub = AppState.addEventListener('change', handleChange);
    return () => sub.remove();
  }, [isAuthenticated]);

  // Drive the system prompt while locked. Re-runs on every retry attempt.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only or stable store refs
  useEffect(() => {
    if (!locked || promptingRef.current) return;
    promptingRef.current = true;

    void (async () => {
      try {
        const [hasHardware, enrolled] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
        ]);

        if (!hasHardware || !enrolled) {
          // No biometrics on this device since the flag was set - release the
          // lock rather than deadlocking the app.
          setLocked(false);
          return;
        }

        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Unlock MTK AlertPro',
          disableDeviceFallback: false,
          cancelLabel: 'Enter app',
        });

        if (result.success) {
          setLocked(false);
          setFailed(false);
        } else {
          setFailed(true);
        }
      } catch {
        setFailed(true);
      } finally {
        promptingRef.current = false;
      }
    })();
  }, [locked, promptAttempt]);

  const retry = useCallback(() => {
    setPromptAttempt((n) => n + 1);
  }, []);

  if (!locked || !isAuthenticated) return null;

  const Icon = failed ? Lock : Fingerprint;

  return (
    <View style={styles.overlay} accessibilityRole="alert">
      <View style={styles.content}>
        <View style={styles.iconWrap}>
          <Icon
            size={44}
            color={designSystem.colors.text.primary}
            strokeWidth={1.6}
          />
        </View>

        <Text style={styles.title}>MTK AlertPro is locked</Text>
        <Text style={styles.subtitle}>
          {failed
            ? 'Authentication failed. Unlock to continue monitoring.'
            : 'Authenticate to return to your cameras and alerts.'}
        </Text>

        <Pressable
          onPress={retry}
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Unlock the app"
        >
          <ScanFace size={18} color={designSystem.colors.background.primary} />
          <Text style={styles.buttonText}>Unlock</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    backgroundColor: designSystem.colors.background.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  content: {
    alignItems: 'center',
    maxWidth: 340,
  },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(248, 250, 252, 0.08)',
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: designSystem.colors.text.primary,
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: 'rgba(248, 250, 252, 0.65)',
    textAlign: 'center',
    marginBottom: 28,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: designSystem.colors.text.primary,
    paddingVertical: 14,
    paddingHorizontal: 30,
    borderRadius: 999,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonText: {
    color: designSystem.colors.background.primary,
    fontSize: 16,
    fontWeight: '700',
  },
});

export default AppLockOverlay;
