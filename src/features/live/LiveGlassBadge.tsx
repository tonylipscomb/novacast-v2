import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaTheme } from '@/theme/tokens';

type LiveGlassBadgeProps = {
  label?: string;
  size?: 'sm' | 'md';
};

/** Frosted glass LIVE chip — readable on TV without relying on BlurView. */
export function LiveGlassBadge({ label = 'LIVE', size = 'sm' }: LiveGlassBadgeProps) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const compact = size === 'sm';

  return (
    <View style={[styles.badge, compact ? styles.badgeSm : styles.badgeMd]} accessibilityLabel={label}>
      <View style={styles.dot} />
      <Text style={[styles.label, compact ? styles.labelSm : styles.labelMd]}>{label}</Text>
    </View>
  );
}

function createStyles(theme: NovaTheme) {
  const onVideo = theme.scheme === 'dark';

  return StyleSheet.create({
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: onVideo ? 'rgba(255,255,255,0.28)' : theme.colors.borderStrong,
      backgroundColor: onVideo ? 'rgba(16, 22, 34, 0.55)' : theme.colors.surface,
      shadowColor: onVideo ? 'rgba(0,0,0,0.45)' : theme.colors.borderSubtle,
      shadowOpacity: 0.35,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
    },
    badgeSm: {
      paddingHorizontal: 9,
      paddingVertical: 4,
    },
    badgeMd: {
      paddingHorizontal: 11,
      paddingVertical: 5,
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 99,
      backgroundColor: theme.colors.danger,
      shadowColor: theme.colors.danger,
      shadowOpacity: 0.9,
      shadowRadius: 4,
    },
    label: {
      color: onVideo ? 'rgba(255,255,255,0.94)' : theme.colors.textPrimary,
      fontWeight: '800',
      letterSpacing: 1.1,
    },
    labelSm: {
      fontSize: 10,
    },
    labelMd: {
      fontSize: 11,
    },
  });
}
