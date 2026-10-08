/**
 * StaggerItem
 *
 * Wraps a list row so it fades + slides in, offset by its index, giving lists a
 * polished cascading entrance instead of popping in all at once. Keeps the
 * stagger math in one place so every list in the app animates identically.
 *
 * Usage:
 *   {items.map((item, i) => (
 *     <StaggerItem key={item.id} index={i}>
 *       <Row {...item} />
 *     </StaggerItem>
 *   ))}
 */

import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { designSystem } from '@/theme/design-system';

export interface StaggerItemProps {
  children: React.ReactNode;
  /** Zero-based position in the list ??? drives the entrance delay. */
  index: number;
  /** Per-item delay step in ms (default 55). */
  step?: number;
  /** Cap so long lists don't wait seconds before the last row appears. */
  maxDelay?: number;
  style?: StyleProp<ViewStyle>;
}

export function StaggerItem({
  children,
  index,
  step = 55,
  maxDelay = 400,
  style,
}: StaggerItemProps) {
  const delay = Math.min(index * step, maxDelay);

  return (
    <Animated.View
      style={style}
      entering={FadeInDown.delay(delay)
        .duration(designSystem.animations.durations.base)
        .springify()
        .damping(18)}
    >
      {children}
    </Animated.View>
  );
}
