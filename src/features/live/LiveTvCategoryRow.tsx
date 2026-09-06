import { memo, useMemo, useState, type ElementRef } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { ProviderCategoryMarker } from '@/components/ProviderCategoryMarker';
import { createNovaTvFocusTextStyles, createNovaTvFocusChrome } from '@/components/nova/novaTvFocus';
import { NOVA_GLASS } from '@/components/nova/novaGlassTheme';
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
      style={[styles.categoryRow, styles.categoryDefault, selected && styles.categoryActive, isFocused && (selected ? styles.categoryActiveFocused : styles.categoryRowFocused)]}>
      {showMarker ? (
        <View style={styles.markerSlot}>
          <ProviderCategoryMarker
            countryCode={category.countryCode}
            regionMarker={category.regionMarker}
            size="md"
          />
        </View>
      ) : null}
      <Text
        numberOfLines={2}
        ellipsizeMode="tail"
        style={[styles.categoryName, selected && styles.categoryNameSelected, isFocused && styles.categoryNameFocused]}>
        {displayName}
      </Text>
      <Text numberOfLines={1} style={[styles.categoryCount, isFocused && styles.categoryCountFocused]}>
        {formatLiveTvCategoryCount(category.count)}
      </Text>
    </Pressable>
  );
}, areLiveTvCategoryRowPropsEqual);

const MARKER_SLOT_WIDTH = 28;

function createStyles(theme: NovaTheme) {
  const focusText = createNovaTvFocusTextStyles(theme);
  const focusChrome = createNovaTvFocusChrome(theme);
  return StyleSheet.create({
    categoryRow: {
      minHeight: 38,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 8,
      paddingVertical: 4,
      ...focusChrome.base,
    },
    // Reuse the navbar's glass focus tokens for category rows.
    categoryRowFocused: {
      borderWidth: 1,
      backgroundColor: NOVA_GLASS.focused.backgroundColor,
      borderColor: NOVA_GLASS.focused.borderColor,
      borderRadius: NOVA_GLASS.radius.base,
    },
    categoryDefault: {
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      borderRadius: 0,
    },
    categoryActive: {
      backgroundColor: NOVA_GLASS.active.backgroundColor,
      borderColor: NOVA_GLASS.active.borderColor,
      borderRadius: NOVA_GLASS.radius.base,
    },
    categoryActiveFocused: {
      borderWidth: 1,
      backgroundColor: NOVA_GLASS.activeFocused.backgroundColor,
      borderColor: NOVA_GLASS.activeFocused.borderColor,
      borderRadius: NOVA_GLASS.radius.base,
    },
    markerSlot: {
      width: MARKER_SLOT_WIDTH,
      alignItems: 'center',
      justifyContent: 'center',
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
  });
}
