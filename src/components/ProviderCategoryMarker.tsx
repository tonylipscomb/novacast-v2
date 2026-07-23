import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import {
  isMultiRegionCategoryMarker,
  normalizeCountryCodeForDisplay,
} from '@/features/series/metadata/titleNormalization';
import { novaTheme } from '@/theme';

type ProviderCategoryMarkerProps = {
  countryCode?: string;
  regionMarker?: 'multi';
  size?: 'md' | 'lg';
};

/**
 * Fire TV often cannot render flag emoji reliably — use compact ISO badges instead.
 */
export function ProviderCategoryMarker({
  countryCode,
  regionMarker,
  size = 'md',
}: ProviderCategoryMarkerProps) {
  const large = size === 'lg';
  const iconSize = large ? 20 : 17;

  if (regionMarker === 'multi' || (countryCode && isMultiRegionCategoryMarker(countryCode))) {
    return (
      <View style={styles.marker} accessibilityLabel="Multi-region category">
        <MaterialCommunityIcons name="earth" size={iconSize} color={novaTheme.colors.accentHover} />
      </View>
    );
  }

  if (!countryCode) {
    return null;
  }

  const label = normalizeCountryCodeForDisplay(countryCode);

  return (
    <View style={[styles.codeBadge, large && styles.codeBadgeLarge]} accessibilityLabel={`${label} category`}>
      <Text style={[styles.code, large && styles.codeLarge]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  marker: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeBadge: {
    flexShrink: 0,
    minWidth: 28,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeBadgeLarge: {
    minWidth: 32,
    paddingHorizontal: 7,
  },
  code: {
    color: novaTheme.colors.accentHover,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  codeLarge: {
    fontSize: 12,
  },
});
