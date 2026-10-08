import { Button } from '@/components/ui'; // Assuming this exists or will be refactored
import { designSystem } from '@/theme/design-system';
import React, { useRef } from 'react';
import {
  type FlatList,
  Image,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
  useAnimatedStyle,
  interpolate,
  Extrapolation,
  type SharedValue,
} from 'react-native-reanimated';

interface OnboardingSlide {
  id: string;
  title: string;
  description: string;
  image: any; // Using any for local require() images or string for URI
}

interface OnboardingCarouselProps {
  slides: OnboardingSlide[];
  onComplete: () => void;
}

const SlideItem = ({
  item,
  index,
  x,
  width,
}: {
  item: OnboardingSlide;
  index: number;
  x: SharedValue<number>;
  width: number;
}) => {
  const animatedImageStyle = useAnimatedStyle(() => {
    const inputRange = [
      (index - 1) * width,
      index * width,
      (index + 1) * width,
    ];

    const translateY = interpolate(
      x.value,
      inputRange,
      [100, 0, 100],
      Extrapolation.CLAMP,
    );

    const scale = interpolate(
      x.value,
      inputRange,
      [0.5, 1, 0.5],
      Extrapolation.CLAMP,
    );

    const opacity = interpolate(
      x.value,
      inputRange,
      [0, 1, 0],
      Extrapolation.CLAMP,
    );

    return {
      transform: [{ translateY }, { scale }],
      opacity,
    };
  });

  const animatedTextStyle = useAnimatedStyle(() => {
    const inputRange = [
      (index - 0.5) * width,
      index * width,
      (index + 0.5) * width,
    ];

    const opacity = interpolate(
      x.value,
      inputRange,
      [0, 1, 0],
      Extrapolation.CLAMP,
    );

    const translateY = interpolate(
      x.value,
      inputRange,
      [50, 0, 50],
      Extrapolation.CLAMP,
    );
    return {
      opacity,
      transform: [{ translateY }],
    };
  });

  return (
    <View style={[styles.slideContainer, { width }]}>
      <Animated.View style={[styles.imageContainer, animatedImageStyle]}>
        {/* Placeholder for image if not provided, or Image component */}
        {typeof item.image === 'number' ? (
          <Image
            source={item.image}
            style={styles.image}
            resizeMode="contain"
          />
        ) : (
          // Placeholder visuals for demo
          <View
            style={[
              styles.placeholderImage,
              {
                backgroundColor:
                  index % 2 === 0
                    ? designSystem.colors.primary[500]
                    : designSystem.colors.status.info,
              },
            ]}
          />
        )}
      </Animated.View>

      <Animated.View style={[styles.textContainer, animatedTextStyle]}>
        <Text style={styles.title}>{item.title}</Text>
        <Text style={styles.description}>{item.description}</Text>
      </Animated.View>
    </View>
  );
};

const Pagination = ({
  data,
  x,
  width,
}: { data: OnboardingSlide[]; x: SharedValue<number>; width: number }) => {
  return (
    <View style={styles.paginationContainer}>
      {data.map((_, index) => {
        const animatedDotStyle = useAnimatedStyle(() => {
          const inputRange = [
            (index - 1) * width,
            index * width,
            (index + 1) * width,
          ];

          const widthVal = interpolate(
            x.value,
            inputRange,
            [10, 20, 10],
            Extrapolation.CLAMP,
          );

          const opacity = interpolate(
            x.value,
            inputRange,
            [0.5, 1, 0.5],
            Extrapolation.CLAMP,
          );

          const backgroundColor =
            interpolate(
              x.value,
              inputRange,
              [0, 1, 0], // Logic simplified, better to use interpolateColor in v2/v3 but simple toggle here
              Extrapolation.CLAMP,
            ) > 0.5
              ? designSystem.colors.primary[500]
              : designSystem.colors.text.muted;

          return {
            width: widthVal,
            opacity,
            backgroundColor,
          };
        });

        return (
          <Animated.View
            // biome-ignore lint/suspicious/noArrayIndexKey: static dot indicators
            key={index}
            style={[styles.dot, animatedDotStyle]}
          />
        );
      })}
    </View>
  );
};

export const OnboardingCarousel: React.FC<OnboardingCarouselProps> = ({
  slides,
  onComplete,
}) => {
  const x = useSharedValue(0);
  const flatListRef = useRef<FlatList>(null);
  const [currentIndex, setCurrentIndex] = React.useState(0);
  // Reactive width. The carousel maths (interpolation offsets, page width)
  // previously read a module-scope Dimensions.get('window'), so rotating the
  // device left the slide offsets and paging mismatched.
  const { width } = useWindowDimensions();

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      x.value = event.contentOffset.x;
    },
  });

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems[0]) {
      setCurrentIndex(viewableItems[0].index);
    }
  }).current;

  return (
    <View style={styles.container}>
      <Animated.FlatList
        ref={flatListRef as any}
        data={slides}
        renderItem={({ item, index }) => (
          <SlideItem item={item} index={index} x={x} width={width} />
        )}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
      />

      <View style={styles.footer}>
        <Pagination data={slides} x={x} width={width} />

        <View style={styles.buttonContainer}>
          {currentIndex === slides.length - 1 ? (
            <Button onPress={onComplete} style={styles.button}>
              Get Started
            </Button>
          ) : (
            <Button
              variant="outline"
              onPress={() => {
                flatListRef.current?.scrollToIndex({
                  index: currentIndex + 1,
                  animated: true,
                });
              }}
              style={styles.button}
            >
              Next
            </Button>
          )}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: designSystem.colors.background.primary,
  },
  slideContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: designSystem.spacing.xl,
  },
  imageContainer: {
    flex: 0.6,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  image: {
    // Was width * 0.8, frozen at the boot width. An aspect-ratio box is
    // responsive and keeps the artwork square.
    width: '80%',
    aspectRatio: 1,
  },
  placeholderImage: {
    width: '70%',
    aspectRatio: 1,
    borderRadius: 999,
    ...designSystem.shadows.glow.primary,
  },
  textContainer: {
    flex: 0.4,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: designSystem.spacing.xl,
  },
  title: {
    fontSize: designSystem.typography.size.display,
    fontFamily: designSystem.typography.fontFamily.bold,
    color: designSystem.colors.text.primary,
    textAlign: 'center',
    marginBottom: designSystem.spacing.md,
  },
  description: {
    fontSize: designSystem.typography.size.lg,
    color: designSystem.colors.text.secondary,
    textAlign: 'center',
    lineHeight: 28,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: designSystem.spacing.xl,
    paddingBottom: 50, // Safe area
  },
  paginationContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: designSystem.spacing.xl,
  },
  dot: {
    height: 8,
    borderRadius: 4,
    marginHorizontal: 4,
  },
  buttonContainer: {
    width: '100%',
  },
  button: {
    width: '100%',
  },
});
