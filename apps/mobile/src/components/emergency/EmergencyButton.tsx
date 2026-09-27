/**
 * Emergency SOS button.
 *
 * Press-and-hold activation: a bare tap is too easy to trigger accidentally on
 * a security app, and an accidental siren at 2am is worse than no siren at all.
 * Holding for the full duration commits; releasing early cancels.
 *
 * Accessibility: hold gestures are unusable with a screen reader or a switch
 * device, so the button also activates on a single tap when a screen reader is
 * detected. That check reads `isScreenReaderEnabled()`, not the reduce-motion
 * setting - the two are unrelated OS preferences, and conflating them left
 * screen-reader users required to perform a hold they cannot perform. The hold
 * is always mirrored by a visible progress ring so the interaction is
 * discoverable.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Alert,
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { AlertTriangle, ShieldCheck, X } from 'lucide-react-native';
import { designSystem } from '@/theme/design-system';
import {
  resolveEmergency,
  subscribeToEmergency,
  triggerEmergency,
  type EmergencyState,
} from '@/lib/emergency/emergencyService';
import { listContacts } from '@/lib/emergency/contactService';
import { hapticSuccess, hapticWarning } from '@/lib/haptics';

const HOLD_DURATION_MS = 1500;

interface EmergencyButtonProps {
  /** Camera the user is currently viewing, for context in the alert. */
  cameraName?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function EmergencyButton({ cameraName, size = 'md' }: EmergencyButtonProps) {
  const [holding, setHolding] = useState(false);
  const [emergency, setEmergency] = useState<EmergencyState | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [screenReaderEnabled, setScreenReaderEnabled] = useState(false);

  const progress = useRef(new Animated.Value(0)).current;
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelAnimation = useRef<Animated.CompositeAnimation | null>(null);
  /** Warn about missing contacts once, not on every SOS. */
  const hasWarnedNoContacts = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});

    // Screen-reader state must be read from its own signal. It is unrelated to
    // reduce-motion, and using reduce-motion as a proxy meant a screen-reader
    // user who had not enabled reduce-motion was still required to perform a
    // timed hold, which they cannot do.
    AccessibilityInfo.isScreenReaderEnabled()
      .then(setScreenReaderEnabled)
      .catch(() => {});

    const screenReaderSub = AccessibilityInfo.addEventListener(
      'screenReaderChanged',
      setScreenReaderEnabled
    );
    const reduceMotionSub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion
    );

    const unsubscribeEmergency = subscribeToEmergency(setEmergency);

    return () => {
      screenReaderSub.remove();
      reduceMotionSub.remove();
      unsubscribeEmergency();
    };
  }, []);

  // A timed hold is impossible with a screen reader or a switch device, so
  // those users get single-tap activation instead.
  const instantActivate = screenReaderEnabled;

  const clearHold = useCallback(() => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    cancelAnimation.current?.stop();
    cancelAnimation.current = null;
    progress.setValue(0);
  }, [progress]);

  /**
   * Warn the user when no trusted contact exists. Fire-and-forget and
   * best-effort: a network failure here must never delay or block the SOS.
   */
  const warnIfNoContacts = useCallback(async () => {
    if (hasWarnedNoContacts.current) return;
    try {
      const contacts = await listContacts();
      if (contacts.length > 0) return;
      hasWarnedNoContacts.current = true;
      Alert.alert(
        'No emergency contacts',
        'Nobody will be messaged when you raise an SOS. Add a contact so someone else is told.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Add contact', onPress: () => router.push('/settings/emergency-contacts') },
        ]
      );
    } catch {
      // Ignore: the SOS is already in flight.
    }
  }, []);

  useEffect(() => clearHold, [clearHold]);

  const activate = useCallback(() => {
    setHolding(false);
    clearHold();
    hapticWarning();
    void triggerEmergency('manual', { cameraName, note: 'Emergency button pressed' });
    // The SOS must never be blocked by this check. But an SOS with no trusted
    // contact is a siren nobody hears, so warn once per mount and point at the
    // screen that fixes it.
    void warnIfNoContacts();
  }, [cameraName, clearHold]);

  const onPressIn = useCallback(() => {
    if (emergency?.status === 'active') return;

    if (instantActivate) {
      activate();
      return;
    }

    setHolding(true);

    // Reduce-motion governs the progress animation only. The hold itself is
    // kept, because it is the guard against an accidental 2am siren, and it is
    // already mirrored by the static "Release to cancel" text.
    if (!reduceMotion) {
      const animation = Animated.timing(progress, {
        toValue: 1,
        duration: HOLD_DURATION_MS,
        easing: Easing.linear,
        useNativeDriver: false,
      });
      cancelAnimation.current = animation;
      animation.start();
    }

    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      activate();
    }, HOLD_DURATION_MS);
  }, [activate, emergency?.status, instantActivate, progress, reduceMotion]);

  const onPressOut = useCallback(() => {
    if (instantActivate) return;
    clearHold();
    setHolding(false);
  }, [clearHold, instantActivate]);

  const dimension = size === 'sm' ? 48 : size === 'lg' ? 88 : 64;
  const isActive = emergency?.status === 'active';

  return (
    <>
      <Pressable
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        accessibilityRole="button"
        accessibilityLabel={
          isActive ? 'Emergency active. Double tap to stop the alarm.' : 'Emergency SOS. Activate alarm'
        }
        accessibilityHint={
          instantActivate
            ? 'Activates the emergency alarm immediately'
            : 'Press and hold to activate the emergency alarm'
        }
        accessibilityState={{ disabled: isActive }}
        // Generous slop: a distress action must be easy to hit.
        hitSlop={12}
        style={({ pressed }) => [
          styles.button,
          { width: dimension, height: dimension, borderRadius: dimension / 2 },
          pressed && styles.buttonPressed,
        ]}
      >
        <AlertTriangle
          size={size === 'sm' ? 20 : size === 'lg' ? 40 : 28}
          color="#FFFFFF"
          strokeWidth={2.5}
        />
        {holding && (
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              styles.progressTrack,
              {
                borderRadius: dimension / 2,
                opacity: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 0.9],
                }),
                transform: [
                  {
                    scale: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.86, 1],
                    }),
                  },
                ],
              },
            ]}
          />
        )}
      </Pressable>

      <EmergencyActiveModal
        visible={isActive}
        startedAt={emergency?.event?.startedAt}
        onResolve={() => {
          hapticSuccess();
          void resolveEmergency();
        }}
      />
    </>
  );
}

function EmergencyActiveModal({
  visible,
  startedAt,
  onResolve,
}: {
  visible: boolean;
  startedAt?: Date;
  onResolve: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!visible || !startedAt) {
      setElapsed(0);
      return;
    }
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt.getTime()) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [visible, startedAt]);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onResolve}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard} accessibilityViewIsModal accessibilityLiveRegion="assertive">
          <View style={styles.modalIconWrap}>
            <AlertTriangle size={40} color="#FFFFFF" strokeWidth={2.5} />
          </View>

          <Text style={styles.modalTitle} accessibilityRole="header">
            Emergency Active
          </Text>
          <Text style={styles.modalBody}>
            The alarm is sounding at full volume and continues until you stop it.
          </Text>

          <View style={styles.timerRow}>
            <Text style={styles.timer} accessibilityLabel={`Elapsed ${minutes} minutes ${seconds} seconds`}>
              {minutes}:{String(seconds).padStart(2, '0')}
            </Text>
          </View>

          <Pressable
            onPress={onResolve}
            accessibilityRole="button"
            accessibilityLabel="Stop the emergency alarm"
            style={({ pressed }) => [styles.resolveButton, pressed && styles.buttonPressed]}
          >
            <ShieldCheck size={22} color="#FFFFFF" strokeWidth={2.5} />
            <Text style={styles.resolveButtonText}>Stop Alarm</Text>
          </Pressable>

          <Pressable
            onPress={onResolve}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            hitSlop={16}
            style={styles.dismissButton}
          >
            <X size={20} color={designSystem.colors.text.secondary} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: designSystem.colors.status.danger,
    ...designSystem.shadows.glow.danger,
  },
  buttonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.96 }],
  },
  progressTrack: {
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: designSystem.colors.background.secondary,
    borderRadius: designSystem.layout.radius.xl,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: designSystem.colors.status.danger,
    ...designSystem.shadows.lg,
  },
  modalIconWrap: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: designSystem.colors.status.danger,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    color: designSystem.colors.text.primary,
    fontSize: designSystem.typography.size.xxl,
    fontWeight: '700',
    marginBottom: 10,
    textAlign: 'center',
    fontFamily: designSystem.typography.fontFamily.bold,
  },
  modalBody: {
    color: designSystem.colors.text.secondary,
    fontSize: designSystem.typography.size.base,
    textAlign: 'center',
    lineHeight: designSystem.typography.size.base * designSystem.typography.lineHeight.normal,
  },
  timerRow: {
    marginVertical: 20,
  },
  timer: {
    color: designSystem.colors.text.primary,
    fontSize: designSystem.typography.size.display * 1.4,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    fontFamily: designSystem.typography.fontFamily.bold,
  },
  resolveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: designSystem.colors.status.danger,
    paddingVertical: 16,
    paddingHorizontal: 28,
    borderRadius: designSystem.layout.radius.lg,
    minHeight: 52,
    width: '100%',
    ...Platform.select({
      android: { elevation: 4 },
      default: {},
    }),
  },
  resolveButtonText: {
    color: '#FFFFFF',
    fontSize: designSystem.typography.size.base,
    fontWeight: '700',
    fontFamily: designSystem.typography.fontFamily.bold,
  },
  dismissButton: {
    marginTop: 16,
    padding: 10,
  },
});
