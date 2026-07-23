import { memo, useMemo, useState, type ElementRef } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { ProviderCategoryMarker } from '@/components/ProviderCategoryMarker';
import type { ProviderLiveCategory } from '@/features/providers/providerRepositories';
import { displayProviderCategoryName } from '@/features/providers/categoryDisplay';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaTheme } from '@/theme/tokens';
import { formatLiveTvCategoryCount } from './liveTvCategoryCount';

type LiveTvCategoryRowProps = {
  category: ProviderLiveCategory;
  selected: boolean;
  preferFocus: boolean;
  nextFocusRight?: number;
  onFocus: () => void;
  onPress: () => void;
  registerRef?: (instance: ElementRef<typeof View> | null) => void;
};

function areLiveTvCategoryRowPropsEqual(previous: LiveTvCategoryRowProps, next: LiveTvCategoryRowProps) {
  return (
    previous.category === next.category &&
    previous.selected === next.selected &&
    previous.preferFocus === next.preferFocus &&
    previous.nextFocusRight === next.nextFocusRight
  );
}

export const LiveTvCategoryRow = memo(function LiveTvCategoryRow({
  category,
  selected,
  preferFocus,
  nextFocusRight,
  onFocus,
  onPress,
  registerRef,
}: LiveTvCategoryRowProps) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [isFocused, setIsFocused] = useState(false);
  const displayName = displayProviderCategoryName({
    name: category.name,
    rawName: category.rawName,
    countryCode: category.countryCode,
    contentType: 'live',
  });
  const showMarker = Boolean(category.countryCode) || category.regionMarker === 'multi';

  return (
    <Pressable
      ref={(instance) => registerRef?.(instance)}
      focusable
      hasTVPreferredFocus={preferFocus}
      {...(Platform.OS === 'android' && nextFocusRight ? { nextFocusRight } : null)}
      accessibilityLabel={`Live TV category ${category.name}`}
      onFocus={() => {
        setIsFocused(true);
        onFocus();
      }}
      onBlur={() => setIsFocused(false)}
      onPress={onPress}
      style={[styles.categoryRow, selected && styles.selectedRow, isFocused && styles.categoryRowFocused]}>
      <View style={[styles.markerSlot, !showMarker && styles.markerSlotHidden]}>
        {showMarker ? (
          <ProviderCategoryMarker
            countryCode={category.countryCode}
            regionMarker={category.regionMarker}
            size="md"
          />
        ) : null}
      </View>
      <Text
        numberOfLines={1}
        ellipsizeMode="tail"
        style={[styles.categoryName, selected && styles.categoryNameSelected, isFocused && styles.categoryNameFocused]}>
        {displayName}
      </Text>
      <Text numberOfLines={1} style={styles.categoryCount}>
        {formatLiveTvCategoryCount(category.count)}
      </Text>
      {selected || isFocused ? <View style={[styles.selectedRail, isFocused && styles.focusRail]} /> : null}
    </Pressable>
  );
}, areLiveTvCategoryRowPropsEqual);

const MARKER_SLOT_WIDTH = 28;

function createStyles(theme: NovaTheme) {
  const lightFocus = theme.scheme === 'light';

  return StyleSheet.create({
    categoryRow: {
      height: 38,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.borderSubtle,
      borderWidth: 1,
      borderColor: 'transparent',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 8,
      paddingVertical: 0,
    },
    categoryRowFocused: lightFocus
      ? {
          borderColor: theme.colors.focusRing,
          backgroundColor: theme.colors.surfaceFocused,
        }
      : {
          backgroundColor: 'transparent',
        },
    markerSlot: {
      width: MARKER_SLOT_WIDTH,
      alignItems: 'center',
      justifyContent: 'center',
    },
    markerSlotHidden: {
      opacity: 0,
    },
    categoryName: {
      flex: 1,
      minWidth: 0,
      color: theme.colors.textPrimary,
      fontSize: 13,
      fontWeight: '600',
      lineHeight: 16,
    },
    categoryNameSelected: {
      color: theme.colors.textPrimary,
    },
    categoryNameFocused: lightFocus
      ? {
          color: theme.colors.accent,
        }
      : {
          color: theme.colors.accentHover,
          textShadowColor: theme.colors.accentHover,
          textShadowOffset: { width: 0, height: 0 },
          textShadowRadius: 8,
        },
    categoryCount: {
      minWidth: 28,
      color: theme.colors.textMuted,
      fontSize: 10,
      fontWeight: '600',
      textAlign: 'right',
    },
    selectedRail: {
      width: 3,
      height: 20,
      borderRadius: 2,
      backgroundColor: theme.colors.success,
      shadowColor: theme.colors.success,
      shadowOpacity: 0.9,
      shadowRadius: 6,
    },
    focusRail: {
      backgroundColor: theme.colors.accentHover,
      shadowColor: theme.colors.accentHover,
      shadowOpacity: lightFocus ? 0 : 0.9,
      shadowRadius: lightFocus ? 0 : 6,
    },
    selectedRow: {
      backgroundColor: 'transparent',
    },
  });
}
