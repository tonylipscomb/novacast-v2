import { memo, useMemo, useState, type ElementRef } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { ProviderCategoryMarker } from '@/components/ProviderCategoryMarker';
import { createNovaTvFocusTextStyles, createNovaTvFocusChrome } from '@/components/nova/novaTvFocus';
import type { ProviderLiveCategory } from '@/features/providers/providerRepositories';
import { displayProviderCategoryName } from '@/features/providers/categoryDisplay';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaTheme } from '@/theme/tokens';
import { formatLiveTvCategoryCount } from './liveTvCategoryCount';
import { dedupeCountryCategoryLabel } from './liveTvCategoryLabel';

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
  const dedupedName = dedupeCountryCategoryLabel(displayName, category.countryCode);
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
        {dedupedName}
      </Text>
      <Text numberOfLines={1} style={[styles.categoryCount, isFocused && styles.categoryCountFocused]}>
        {formatLiveTvCategoryCount(category.count)}
      </Text>
      {selected || isFocused ? <View style={[styles.selectedRail, isFocused && styles.focusRail]} /> : null}
    </Pressable>
  );
}, areLiveTvCategoryRowPropsEqual);

const MARKER_SLOT_WIDTH = 28;

function createStyles(theme: NovaTheme) {
  const focusText = createNovaTvFocusTextStyles(theme);
  const focusChrome = createNovaTvFocusChrome(theme);

  return StyleSheet.create({
    categoryRow: {
      height: 38,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.borderSubtle,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 8,
      paddingVertical: 0,
      ...focusChrome.base,
    },
    categoryRowFocused: focusChrome.active,
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
    categoryNameFocused: focusText.title,
    categoryCount: {
      minWidth: 28,
      color: theme.colors.textMuted,
      fontSize: 10,
      fontWeight: '600',
      textAlign: 'right',
    },
    categoryCountFocused: focusText.count,
    selectedRail: {
      width: 3,
      height: 20,
      borderRadius: 2,
      backgroundColor: theme.colors.textPrimary,
    },
    focusRail: {
      // Glass box carries focus; keep rail width for layout stability only.
      backgroundColor: 'transparent',
      shadowOpacity: 0,
    },
    selectedRow: {
      backgroundColor: 'transparent',
    },
  });
}
