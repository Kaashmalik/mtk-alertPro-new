import { designSystem } from '@/theme/design-system';
import type React from 'react';
import { useEffect } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';

interface LoadingSkeletonProps {
  width?: number | string;
  height?: number | string;
  style?: ViewStyle;
  borderRadius?: number;
}

export const LoadingSkeleton: React.FC<LoadingSkeletonProps> = ({
  width = '100%',
  height = 20,
  style,
  borderRadius = designSystem.layout.radius.sm,
}) => {
  const opacity = useSharedValue(0.3);

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only or stable store refs
  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.7, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.3, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      true, // reverse
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        styles.skeleton,
        { width: width as any, height: height as any, borderRadius },
        animatedStyle,
        style,
      ]}
    />
  );
};

/**
 * Pre-configured Card Skeleton for Cameras
 */
export const CameraCardSkeleton: React.FC = () => {
  return (
    <View style={styles.cardContainer}>
      <LoadingSkeleton
        height={200}
        borderRadius={designSystem.layout.radius.xl}
      />
      <View style={styles.cardInfo}>
        <LoadingSkeleton width="60%" height={20} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: designSystem.colors.background.tertiary,
  },
  cardContainer: {
    marginBottom: designSystem.spacing.md,
    overflow: 'hidden',
  },
  cardInfo: {
    marginTop: designSystem.spacing.xs,
    marginLeft: designSystem.spacing.sm,
  },
});
