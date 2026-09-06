import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaTheme } from '@/theme/tokens';
import { NovaCastPlanetLoader } from '@/components/nova/NovaCastPlanetLoader';

import {
  LIVE_TV_CHANNEL_LIST_REVEAL_MS,
  LIVE_TV_CHANNEL_LIST_REVEAL_START_OPACITY,
} from './liveTvChannelPanelLoader';

type LiveTvPlanetLoaderProps = {
  label?: string;
};

type LiveTvChannelListRevealProps = {
  children: ReactNode;
  /** Remounts the one-shot fade when the channel batch identity changes. */
  revealKey?: string;
};

/** One-shot 120ms native opacity fade when the channel list first replaces the loader. */
export function LiveTvChannelListReveal({ children, revealKey }: LiveTvChannelListRevealProps) {
  const opacity = useRef(new Animated.Value(LIVE_TV_CHANNEL_LIST_REVEAL_START_OPACITY)).current;

  useEffect(() => {
    opacity.setValue(LIVE_TV_CHANNEL_LIST_REVEAL_START_OPACITY);
    const fade = Animated.timing(opacity, {
      toValue: 1,
      duration: LIVE_TV_CHANNEL_LIST_REVEAL_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    fade.start();
    return () => fade.stop();
  }, [opacity, revealKey]);

  return <Animated.View style={[stylesReveal.fill, { opacity }]} pointerEvents="box-none">{children}</Animated.View>;
}

const stylesReveal = StyleSheet.create({
  fill: {
    flex: 1,
  },
});

/**
 * Tiny NovaCast mark spinner for Live channel-panel waits.
 * Native-driver only: one slow rotate + a soft opacity breath. No JS timers.
 */
export function LiveTvPlanetLoader({ label = 'Loading channels…' }: LiveTvPlanetLoaderProps) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View
      style={styles.root}
      pointerEvents="none"
      focusable={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      accessibilityRole="progressbar"
      accessibilityLabel={label}>
      <NovaCastPlanetLoader size={32} />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

function createStyles(theme: NovaTheme) {
  return StyleSheet.create({
    root: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      paddingHorizontal: 16,
    },
    mark: {
      width: 40,
      height: 40,
    },
    label: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      fontWeight: '600',
      letterSpacing: 0.2,
    },
  });
}
