import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

import { novaTheme } from '@/theme';

type NovaFocusTextProps = {
  active: boolean;
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
};

/** Subtle white ↔ accent text pulse for TV focus — no boxes or rings. */
export function NovaFocusText({ active, children, style, numberOfLines }: NovaFocusTextProps) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      pulse.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1_200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1_200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
      ]),
    );

    loop.start();
    return () => loop.stop();
  }, [active, pulse]);

  if (!active) {
    return (
      <Text style={style} numberOfLines={numberOfLines}>
        {children}
      </Text>
    );
  }

  const color = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [novaTheme.colors.textPrimary, novaTheme.colors.accentHover],
  });

  return (
    <Animated.Text style={[style, styles.pulseText, { color }]} numberOfLines={numberOfLines}>
      {children}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  pulseText: {
    fontWeight: '700',
  },
});
