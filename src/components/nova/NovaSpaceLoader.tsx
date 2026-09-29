import { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaTheme } from '@/theme/tokens';

import { NovaCastPlanetLoader } from './NovaCastPlanetLoader';

type NovaSpaceLoaderProps = {
  label?: string;
  /**
   * panel = rocket + label + energy bar;
   * inline = row;
   * badge = compact pulsing rocket only;
   * hero = large transparent spaceship (Movies Stage 3E primary loader)
   */
  variant?: 'inline' | 'panel' | 'badge' | 'hero';
};

export function NovaSpaceLoader({ label = 'Loading…', variant = 'panel' }: NovaSpaceLoaderProps) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [pulse] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1_400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1_400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    pulseLoop.start();
    return () => {
      pulseLoop.stop();
    };
  }, [pulse]);

  const energyScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });
  if (variant === 'badge') {
    return (
      <View style={styles.badge} accessibilityRole="progressbar" accessibilityLabel={label}>
        <NovaCastPlanetLoader size={40} />
      </View>
    );
  }

  if (variant === 'hero') {
    return (
      <View style={styles.hero} accessibilityRole="progressbar" accessibilityLabel={label}>
        <NovaCastPlanetLoader size={72} />
      </View>
    );
  }

  if (variant === 'inline') {
    return (
      <View style={styles.inlineRow} accessibilityRole="progressbar" accessibilityLabel={label}>
        <NovaCastPlanetLoader size={22} />
        <Text style={styles.inlineLabel}>{label}</Text>
      </View>
    );
  }

  return (
    <View style={styles.panel} accessibilityRole="progressbar" accessibilityLabel={label}>
      <NovaCastPlanetLoader size={56} />

      <Text style={styles.label}>{label}</Text>

      <View style={styles.energyTrack}>
        <Animated.View style={[styles.energyLine, { transform: [{ scaleX: energyScale }] }]} />
      </View>
    </View>
  );
}

function createStyles(theme: NovaTheme) {
  return StyleSheet.create({
    panel: {
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'center',
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 12,
      minWidth: 160,
      backgroundColor: 'transparent',
    },
    hero: {
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'center',
      backgroundColor: 'transparent',
      borderWidth: 0,
      // No card / shadow wrapper — spaceship only.
    },
    heroRocketWrap: {
      width: 96,
      height: 96,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
    },
    heroGlow: {
      position: 'absolute',
      width: 72,
      height: 72,
      borderRadius: 99,
      backgroundColor: theme.scheme === 'light' ? 'rgba(12, 74, 110, 0.14)' : 'rgba(59, 130, 246, 0.22)',
    },
    rocketWrap: {
      width: 72,
      height: 72,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1,
    },
    rocketGlow: {
      position: 'absolute',
      width: 64,
      height: 64,
      borderRadius: 99,
      backgroundColor: theme.scheme === 'light' ? 'rgba(12, 74, 110, 0.18)' : 'rgba(59, 130, 246, 0.28)',
      shadowColor: theme.colors.accent,
      shadowOpacity: 0.55,
      shadowRadius: 18,
    },
    label: {
      color: theme.colors.textPrimary,
      fontSize: 15,
      fontWeight: '700',
      textAlign: 'center',
      zIndex: 1,
    },
    energyTrack: {
      width: 132,
      height: 2,
      marginTop: 2,
      overflow: 'hidden',
      borderRadius: 99,
      backgroundColor: theme.scheme === 'light' ? 'rgba(12, 74, 110, 0.2)' : 'rgba(95, 149, 216, 0.28)',
      zIndex: 1,
    },
    energyLine: {
      width: '100%',
      height: '100%',
      borderRadius: 99,
      backgroundColor: theme.colors.accentHover,
    },
    badge: {
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'center',
    },
    badgeRocketWrap: {
      width: 48,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeGlow: {
      position: 'absolute',
      width: 40,
      height: 40,
      borderRadius: 99,
      backgroundColor: theme.scheme === 'light' ? 'rgba(12, 74, 110, 0.16)' : 'rgba(59, 130, 246, 0.26)',
    },
    inlineRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 4,
      paddingVertical: 8,
    },
    inlineRocket: {
      width: 26,
      height: 26,
    },
    inlineLabel: {
      color: theme.colors.textPrimary,
      fontSize: 15,
      fontWeight: '700',
    },
  });
}
