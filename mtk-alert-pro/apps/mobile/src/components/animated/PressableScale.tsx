/**
 * PressableScale
 *
 * A drop-in, premium press primitive: the content springs down slightly on
 * touch and back on release, with optional haptic feedback. This is the single
 * micro-interaction that makes a UI feel "2026 native" — every tappable surface
 * reacts to the finger instead of just flashing opacity.
 *
 * Built on react-native-gesture-handler + reanimated so the animation runs on
 * the UI thread (no JS-thread jank), and it honours the app's spring tokens so
 * motion is consistent everywhere it's used.
 *
 * Usage — a direct, behaviour-compatible replacement for a TouchableOpacity:
 *   <PressableScale onPress={...} style={styles.card}>...</PressableScale>
 */

import React, { useCallback } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { designSystem } from '@/theme/design-system';
import { triggerHaptic, type HapticType } from '@/lib/haptics';

export interface PressableScaleProps {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  /** How far to scale down while pressed (0.96 = 4% shrink). */
  activeScale?: number;
  /** Haptic fired on a completed press. Pass null to disable. */
  haptic?: HapticType | null;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Accessibility label forwarded to the animated view. */
  accessibilityLabel?: string;
  hitSlop?: number;
}

export function PressableScale({
  children,
  onPress,
  onLongPress,
  activeScale = 0.96,
  haptic = 'light',
  disabled = false,
  style,
  accessibilityLabel,
  hitSlop,
}: PressableScaleProps) {
  const scale = useSharedValue(1);

  const fireHaptic = useCallback(() => {
    if (haptic) triggerHaptic(haptic);
  }, [haptic]);

  const spring = designSystem.animations.spring.stiff;

  // Callbacks run on the JS thread (runOnJS(true)), so we can call the handlers
  // directly without the deprecated runOnJS() wrapper. Setting the shared value
  // still drives the spring on the UI thread, so the press animation stays
  // smooth.
  const tap = Gesture.Tap()
    .runOnJS(true)
    .enabled(!disabled)
    .maxDuration(10000)
    .onBegin(() => {
      scale.value = withSpring(activeScale, spring);
    })
    .onFinalize(() => {
      scale.value = withSpring(1, spring);
    })
    .onEnd(() => {
      if (onPress) {
        fireHaptic();
        onPress();
      }
    });

  const longPress = Gesture.LongPress()
    .runOnJS(true)
    .enabled(!disabled && !!onLongPress)
    .minDuration(450)
    .onStart(() => {
      if (onLongPress) {
        triggerHaptic('medium');
        onLongPress();
      }
    });

  const gesture = Gesture.Simultaneous(tap, longPress);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: disabled ? 0.5 : 1,
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[style, animatedStyle]}
        accessible
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled }}
        hitSlop={hitSlop ? { top: hitSlop, bottom: hitSlop, left: hitSlop, right: hitSlop } : undefined}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  );
}
