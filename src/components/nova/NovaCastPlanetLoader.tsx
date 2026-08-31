import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

const NOVACAST_PLANET = require('../../../assets/images/novacast-planet.png');
const NOVACAST_RING = require('../../../assets/images/novacast-ring.png');

type NovaCastPlanetLoaderProps = {
  size: number;
  style?: StyleProp<ViewStyle>;
};

/** Layered NovaCast loader: the sphere turns on its Y axis while the orbit stays fixed. */
export function NovaCastPlanetLoader({ size, style }: NovaCastPlanetLoaderProps) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const breathe = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1_100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 1_100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    breathe.start();
    return () => {
      breathe.stop();
    };
  }, [pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1.04] });
  const glowScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1.12] });
  const glowOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.72] });
  const haloOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.08, 0.34] });
  const layer = { width: size, height: size };

  return (
    <Animated.View style={[styles.root, layer, style]}>
      <Animated.View style={[styles.halo, { width: size * 0.9, height: size * 0.9, borderRadius: size, opacity: haloOpacity, transform: [{ scale: glowScale }] }]} />
      <Animated.View style={[styles.glow, { width: size * 0.78, height: size * 0.78, borderRadius: size, opacity: glowOpacity, transform: [{ scale: glowScale }] }]} />
      <Image source={NOVACAST_PLANET} resizeMode="contain" style={[styles.layer, layer]} />
      <Image source={NOVACAST_RING} resizeMode="contain" style={[styles.layer, layer]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  layer: { position: 'absolute' },
  glow: {
    position: 'absolute',
    backgroundColor: 'rgba(48, 154, 255, 0.48)',
    shadowColor: '#9B5CFF',
    shadowOpacity: 1,
    shadowRadius: 22,
  },
  halo: {
    position: 'absolute',
    backgroundColor: 'rgba(155, 92, 255, 0.28)',
    shadowColor: '#30C8FF',
    shadowOpacity: 0.9,
    shadowRadius: 28,
  },
});
