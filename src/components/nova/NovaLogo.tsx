import { useMemo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/theme/AppThemeProvider';
import { getThemeLogoSource, getThemeMarkSource, themeLogoIncludesWordmark } from '@/theme/brandingAssets';
import type { NovaTheme } from '@/theme/tokens';

type NovaLogoProps = {
  subtitle?: string;
  variant?: 'compact' | 'full' | 'mark';
  size?: 'sm' | 'md' | 'lg' | 'xl';
};

const markSizes = {
  sm: 38,
  md: 52,
  lg: 74,
  xl: 112,
} as const;

const fullLogoSizes = {
  sm: 96,
  md: 140,
  lg: 200,
  xl: 280,
} as const;

export function NovaLogo({ subtitle, variant = 'full', size = 'md' }: NovaLogoProps) {
  const { theme, themeId } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const brandedWordmark = themeLogoIncludesWordmark(themeId);
  const markSize = markSizes[size];
  const fullSize = fullLogoSizes[size];
  const showTextWordmark = variant !== 'mark' && !brandedWordmark;

  if (variant === 'full' && brandedWordmark) {
    return (
      <View style={[styles.container, styles.brandedColumn]}>
        <Image
          source={getThemeLogoSource(themeId)}
          style={{ width: fullSize, height: fullSize }}
          resizeMode="contain"
        />
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
    );
  }

  return (
    <View style={[styles.container, variant === 'compact' && styles.compact]}>
      <Image
        source={getThemeMarkSource(themeId)}
        style={{ width: markSize, height: markSize }}
        resizeMode="contain"
      />
      {showTextWordmark ? (
        <View style={styles.copy}>
          <Text
            style={[
              styles.wordmark,
              size === 'sm' && styles.wordmarkSm,
              size === 'lg' && styles.wordmarkLg,
              size === 'xl' && styles.wordmarkXl,
            ]}>
            NOVACAST
          </Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
      ) : subtitle && variant !== 'mark' ? (
        <View style={styles.copy}>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
      ) : null}
    </View>
  );
}

function createStyles(theme: NovaTheme) {
  return StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    brandedColumn: {
      flexDirection: 'column',
      alignItems: 'center',
      gap: 8,
    },
    compact: {
      gap: 8,
    },
    copy: {
      justifyContent: 'center',
    },
    wordmark: {
      color: theme.colors.textPrimary,
      fontSize: 24,
      fontWeight: '900',
      letterSpacing: 1.8,
    },
    wordmarkSm: {
      fontSize: 18,
      letterSpacing: 1.2,
    },
    wordmarkLg: {
      fontSize: 32,
      letterSpacing: 2.2,
    },
    wordmarkXl: {
      fontSize: 42,
      letterSpacing: 2.8,
    },
    subtitle: {
      marginTop: 2,
      color: theme.colors.textSecondary,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 1.4,
    },
  });
}
