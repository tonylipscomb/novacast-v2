import { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaTheme } from '@/theme/tokens';

type NovaSpaceLoaderProps = {
  label?: string;
  variant?: 'inline' | 'panel';
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

  const rocketScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const rocketGlow = pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.35, 0.85, 0.35] });
  const energyScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });
  const accent = theme.colors.accentHover;

  if (variant === 'inline') {
    return (
      <View style={styles.inlineRow} accessibilityRole="progressbar" accessibilityLabel={label}>
        <Animated.View style={{ transform: [{ scale: rocketScale }] }}>
          <MaterialCommunityIcons name="rocket-launch" size={18} color={accent} />
        </Animated.View>
        <Text style={styles.inlineLabel}>{label}</Text>
      </View>
    );
  }

  return (
    <View style={styles.panel} accessibilityRole="progressbar" accessibilityLabel={label}>
      <Animated.View style={[styles.rocketWrap, { transform: [{ scale: rocketScale }] }]}>
        <Animated.View style={[styles.rocketGlow, { opacity: rocketGlow }]} />
        <MaterialCommunityIcons name="rocket-launch" size={42} color={accent} />
      </Animated.View>

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
    inlineRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 4,
      paddingVertical: 8,
    },
    inlineLabel: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      fontWeight: '600',
    },
  });
}
