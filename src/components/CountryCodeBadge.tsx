import { StyleSheet, Text, View } from 'react-native';

import { countryCodeToFlagEmoji, normalizeCountryCodeForDisplay } from '@/features/series/metadata/titleNormalization';
import { novaTheme } from '@/theme';

type CountryCodeBadgeProps = {
  countryCode: string;
  compact?: boolean;
};

/**
 * Fire TV often fails to render flag emoji; show a styled ISO code badge (and emoji when supported).
 */
export function CountryCodeBadge({ countryCode, compact = false }: CountryCodeBadgeProps) {
  const label = normalizeCountryCodeForDisplay(countryCode);
  const flag = countryCodeToFlagEmoji(countryCode);

  return (
    <View style={[styles.badge, compact && styles.badgeCompact]} accessibilityLabel={`${label} category`}>
      {flag ? <Text style={[styles.flag, compact && styles.flagCompact]}>{flag}</Text> : null}
      <Text style={[styles.code, compact && styles.codeCompact]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexShrink: 0,
    minWidth: 34,
    minHeight: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(97,165,255,0.35)',
    backgroundColor: 'rgba(59,130,246,0.14)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeCompact: {
    minWidth: 30,
    minHeight: 20,
    paddingHorizontal: 5,
  },
  flag: {
    fontSize: 13,
    lineHeight: 15,
  },
  flagCompact: {
    fontSize: 12,
    lineHeight: 14,
  },
  code: {
    color: novaTheme.colors.accentHover,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  codeCompact: {
    fontSize: 9,
  },
});
