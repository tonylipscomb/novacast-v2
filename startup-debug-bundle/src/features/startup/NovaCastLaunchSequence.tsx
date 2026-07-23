import { useEffect, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';

const STATUS_MESSAGES = [
  'Connecting to your provider...',
  'Restoring your session...',
  'Loading channels...',
  'Preparing your guide...',
  'Almost ready...',
];

type LaunchStar = {
  left: `${number}%`;
  top: `${number}%`;
  size: number;
  distance: number;
  delay: number;
};

const STARS: LaunchStar[] = [
  { left: '8%', top: '18%', size: 2, distance: 72, delay: 0 },
  { left: '16%', top: '64%', size: 3, distance: 110, delay: 260 },
  { left: '26%', top: '27%', size: 2, distance: 84, delay: 480 },
  { left: '34%', top: '76%', size: 2, distance: 126, delay: 720 },
  { left: '48%', top: '14%', size: 2, distance: 94, delay: 120 },
  { left: '59%', top: '82%', size: 3, distance: 118, delay: 620 },
  { left: '68%', top: '24%', size: 2, distance: 82, delay: 340 },
  { left: '78%', top: '68%', size: 2, distance: 106, delay: 900 },
  { left: '88%', top: '34%', size: 3, distance: 130, delay: 540 },
  { left: '93%', top: '78%', size: 2, distance: 96, delay: 180 },
];

export function NovaCastLaunchSequence({ ready }: { ready: boolean }) {
  const [statusIndex, setStatusIndex] = useState(0);
  const [warpProgress] = useState(() => new Animated.Value(0));
  const [starProgress] = useState(() => STARS.map(() => new Animated.Value(0)));

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(warpProgress, {
          toValue: 1,
          duration: 2_750,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(warpProgress, {
          toValue: 0,
          duration: 2_750,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();
    return () => animation.stop();
  }, [warpProgress]);

  useEffect(() => {
    const animations = starProgress.map((progress, index) => {
      const star = STARS[index];
      const animation = Animated.loop(
        Animated.sequence([
          Animated.delay(star.delay),
          Animated.timing(progress, {
            toValue: 1,
            duration: 1_250,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(progress, {
            toValue: 0,
            duration: 1_250,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      );
      animation.start();
      return animation;
    });

    return () => animations.forEach((animation) => animation.stop());
  }, [starProgress]);

  useEffect(() => {
    if (ready) {
      return;
    }

    const timer = setInterval(() => {
      setStatusIndex((current) => (current + 1) % (STATUS_MESSAGES.length - 1));
    }, 1_100);

    return () => clearInterval(timer);
  }, [ready]);

  const warpScale = warpProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const warpTranslateX = warpProgress.interpolate({ inputRange: [0, 1], outputRange: [-12, 18] });
  const warpOpacity = warpProgress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.16, 0.34, 0.2] });
  const displayedStatus = ready ? STATUS_MESSAGES.length - 1 : statusIndex;

  return (
    <>
      <View pointerEvents="none" style={styles.root} accessibilityElementsHidden>
      <Image source={require('../../../splash.png')} style={styles.baseArtwork} resizeMode="cover" />
      <Animated.View style={[styles.warpArtwork, { opacity: warpOpacity, transform: [{ translateX: warpTranslateX }, { scale: warpScale }] }]}>
        <Image source={require('@/assets/images/novacastnewcard.png')} style={styles.warpImage} resizeMode="cover" />
      </Animated.View>

      <View style={styles.starField}>
        {STARS.map((star, index) => {
          const progress = starProgress[index];
          const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [0, star.distance] });
          const opacity = progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.2, 1, 0.15] });
          return (
            <Animated.View
              key={`${star.left}-${star.top}`}
              style={[
                styles.star,
                { left: star.left, top: star.top, width: star.size, height: star.size, opacity, transform: [{ translateX }] },
              ]}
            />
          );
        })}
      </View>
      </View>

      <View pointerEvents="none" style={styles.statusBlock}>
        <View style={styles.statusRule} />
        <Text style={styles.statusText}>{STATUS_MESSAGES[displayedStatus]}</Text>
        <Text style={styles.statusHint}>NovaCast</Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#02030A',
    overflow: 'hidden',
  },
  baseArtwork: {
    ...StyleSheet.absoluteFillObject,
  },
  warpArtwork: {
    ...StyleSheet.absoluteFillObject,
  },
  warpImage: {
    width: '100%',
    height: '100%',
  },
  starField: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  star: {
    position: 'absolute',
    borderRadius: 99,
    backgroundColor: '#B9E8FF',
    shadowColor: '#2F8BFF',
    shadowOpacity: 0.8,
    shadowRadius: 8,
  },
  statusBlock: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '76%',
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
    elevation: 100,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(3, 7, 22, 0.88)',
  },
  statusRule: {
    width: 92,
    height: 2,
    marginBottom: 14,
    backgroundColor: '#48A9FF',
    opacity: 0.8,
  },
  statusText: {
    color: '#F7FBFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  statusHint: {
    marginTop: 8,
    color: '#8EA7C9',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
});
