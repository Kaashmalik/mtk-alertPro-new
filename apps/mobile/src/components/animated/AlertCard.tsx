import { formatTimeOfDay } from '@/lib/utils/date';
import { designSystem } from '@/theme/design-system';
import { AlertTriangle, ChevronRight, Clock } from 'lucide-react-native';
import type React from 'react';
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  runOnJS,
  SlideInRight,
  SlideOutRight,
  Layout,
} from 'react-native-reanimated';

interface AlertCardProps {
  id: string;
  type: 'person' | 'vehicle' | 'motion' | 'face' | 'animal' | 'emergency';
  confidence: number;
  timestamp: Date;
  thumbnailUrl?: string;
  cameraName: string;
  personName?: string;
  isRead?: boolean;
  onPress: (id: string) => void;
  onDismiss?: (id: string) => void;
}

export const AlertCard: React.FC<AlertCardProps> = ({
  id,
  type,
  confidence,
  timestamp,
  thumbnailUrl,
  cameraName,
  personName,
  isRead = false,
  onPress,
  onDismiss,
}) => {
  const translateX = useSharedValue(0);
  const startX = useSharedValue(0);
  // Reactive width: the swipe distance was derived from a module-scope
  // Dimensions.get('window'), which froze at the boot width and so ignored
  // rotation, split-screen and tablet resizes.
  const { width } = useWindowDimensions();
  const SWIPE_THRESHOLD = width * 0.3;

  const iconMap = {
    person: '👤',
    vehicle: '🚗',
    motion: '💨',
    face: '🔍',
    animal: '🐾',
    emergency: '🆘',
  };

  const gesture = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .onStart(() => {
      startX.value = translateX.value;
    })
    .onUpdate((event) => {
      if (event.translationX < 0) {
        translateX.value = startX.value + event.translationX;
      }
    })
    .onEnd((event) => {
      if (event.translationX < -SWIPE_THRESHOLD) {
        translateX.value = withTiming(-width, {}, (finished) => {
          if (finished && onDismiss) {
            runOnJS(onDismiss)(id);
          }
        });
      } else {
        translateX.value = withSpring(0);
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const formatTime = (date: Date) => {
    // `toLocaleTimeString` throws RangeError on an Invalid Date, which would
    // take down the whole list from inside renderItem.
    return formatTimeOfDay(date);
  };

  return (
    <Animated.View
      entering={SlideInRight}
      exiting={SlideOutRight}
      layout={Layout.springify()}
      style={styles.wrapper}
    >
      <View style={styles.backgroundContainer}>
        <View style={styles.deleteAction}>
          <Text style={styles.deleteText}>Dismiss</Text>
        </View>
      </View>

      <GestureDetector gesture={gesture}>
        <Animated.View
          style={[
            styles.container,
            isRead && styles.containerRead,
            animatedStyle,
          ]}
        >
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => onPress(id)}
            style={styles.touchable}
          >
            {/* Thumbnail */}
            <View style={styles.thumbnailContainer}>
              {thumbnailUrl ? (
                <Image
                  source={{ uri: thumbnailUrl }}
                  style={styles.thumbnail}
                />
              ) : (
                <View style={[styles.thumbnail, styles.placeholder]}>
                  <AlertTriangle
                    size={24}
                    color={designSystem.colors.status.warning}
                  />
                </View>
              )}
            </View>

            {/* Content */}
            <View style={styles.content}>
              <View style={styles.header}>
                <Text style={styles.title}>
                  {iconMap[type] ?? iconMap.motion}{' '}
                  {String(type ?? 'motion')
                    .charAt(0)
                    .toUpperCase()}
                  {String(type ?? 'motion').slice(1)} Detected
                </Text>
                <Text style={styles.confidence}>
                  {Number.isFinite(confidence)
                    ? `${Math.round(Math.min(1, Math.max(0, confidence)) * 100)}%`
                    : '--'}
                </Text>
              </View>

              <Text style={styles.subtitle}>
                {personName ? `${personName} · ${cameraName}` : cameraName}
              </Text>

              <View style={styles.footer}>
                <Clock size={12} color={designSystem.colors.text.muted} />
                <Text style={styles.time}>{formatTime(timestamp)}</Text>
              </View>
            </View>

            {/* Action Icon */}
            <ChevronRight size={20} color={designSystem.colors.text.muted} />
          </TouchableOpacity>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: designSystem.spacing.sm,
    position: 'relative',
  },
  backgroundContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: designSystem.colors.status.danger,
    borderRadius: designSystem.layout.radius.lg,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: designSystem.spacing.lg,
  },
  deleteAction: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: {
    color: '#FFF',
    fontWeight: '600',
    fontSize: designSystem.typography.size.sm,
  },
  container: {
    backgroundColor: designSystem.colors.background.secondary,
    borderRadius: designSystem.layout.radius.lg,
    overflow: 'hidden',
    borderLeftWidth: 4,
    borderLeftColor: designSystem.colors.status.warning,
  },
  containerRead: {
    opacity: 0.6,
  },
  touchable: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: designSystem.spacing.md,
  },
  thumbnailContainer: {
    marginRight: designSystem.spacing.md,
  },
  thumbnail: {
    width: 60,
    height: 60,
    borderRadius: designSystem.layout.radius.md,
  },
  placeholder: {
    backgroundColor: designSystem.colors.background.tertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  title: {
    color: designSystem.colors.text.primary,
    fontSize: designSystem.typography.size.base,
    fontWeight: '600',
  },
  confidence: {
    color: designSystem.colors.status.warning,
    fontSize: designSystem.typography.size.xs,
    fontWeight: '700',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  subtitle: {
    color: designSystem.colors.text.secondary,
    fontSize: designSystem.typography.size.sm,
    marginBottom: designSystem.spacing.xs,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  time: {
    color: designSystem.colors.text.muted,
    fontSize: designSystem.typography.size.xs,
    marginLeft: 4,
  },
});
