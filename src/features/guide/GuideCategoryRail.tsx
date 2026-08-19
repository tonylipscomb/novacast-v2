import { memo, useCallback, useMemo, useReducer, useRef, useState, type ElementRef } from 'react';
import { findNodeHandle, FlatList, Pressable, StyleSheet, Text } from 'react-native';

import { ProviderCategoryMarker } from '@/components/ProviderCategoryMarker';
import { createNovaTvFocusTextStyles, createNovaTvFocusChrome } from '@/components/nova/novaTvFocus';
import type { ProviderLiveCategory } from '@/features/providers/providerRepositories';
import { displayProviderCategoryName } from '@/features/providers/categoryDisplay';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaTheme } from '@/theme/tokens';

type Focusable = ElementRef<typeof Pressable>;

export type GuideCategoryRailItem = Pick<
  ProviderLiveCategory,
  'id' | 'renderKey' | 'name' | 'rawName' | 'count' | 'countryCode' | 'regionMarker'
>;

type GuideCategoryRailProps = {
  categories: GuideCategoryRailItem[];
  selectedCategoryId: string;
  onSelect: (categoryId: string) => void;
  onFocusChange?: (focused: boolean) => void;
  registerItemRef?: (categoryId: string, instance: Focusable | null) => void;
};

function getHandle(instance: Focusable | null | undefined) {
  return instance ? findNodeHandle(instance) ?? undefined : undefined;
}

function formatCategoryCount(count: number | null) {
  if (count === null || count < 0) return '';
  return String(count);
}

type ChipProps = {
  category: GuideCategoryRailItem;
  selected: boolean;
  leftHandle?: number;
  rightHandle?: number;
  onRef: (instance: Focusable | null) => void;
  onFocus: () => void;
  onBlur: () => void;
  onPress: () => void;
};

const GuideCategoryChip = memo(function GuideCategoryChip({
  category,
  selected,
  leftHandle,
  rightHandle,
  onRef,
  onFocus,
  onBlur,
  onPress,
}: ChipProps) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [isFocused, setIsFocused] = useState(false);
  const countText = formatCategoryCount(category.count);
  const displayName = displayProviderCategoryName({
    name: category.name,
    rawName: category.rawName,
    countryCode: category.countryCode,
    contentType: 'live',
  });
  const showMarker = Boolean(category.countryCode) || category.regionMarker === 'multi';

  return (
    <Pressable
      ref={onRef}
      focusable
      accessibilityRole="button"
      accessibilityLabel={`Guide category ${category.name}`}
      {...(leftHandle !== undefined ? { nextFocusLeft: leftHandle } : null)}
      {...(rightHandle !== undefined ? { nextFocusRight: rightHandle } : null)}
      onFocus={() => {
        setIsFocused(true);
        onFocus();
      }}
      onBlur={() => {
        setIsFocused(false);
        onBlur();
      }}
      onPress={onPress}
      style={[styles.chipInner, selected && styles.chipInnerSelected, isFocused && styles.chipInnerFocused]}>
      {showMarker ? (
        <ProviderCategoryMarker
          countryCode={category.countryCode}
          regionMarker={category.regionMarker}
          size="md"
        />
      ) : null}
      <Text
        style={[
          styles.chipName,
          selected && styles.chipNameSelected,
          isFocused && styles.chipNameFocused,
        ]}>
        {displayName}
      </Text>
      {countText ? (
        <Text style={[styles.chipCount, isFocused && styles.chipCountFocused]}>{countText}</Text>
      ) : null}
    </Pressable>
  );
});

/**
 * Compact horizontal category rail above the Guide timeline. Text-style
 * selection (underline) matching Movies / Live — no chip cards.
 */
export function GuideCategoryRail({ categories, selectedCategoryId, onSelect, onFocusChange, registerItemRef }: GuideCategoryRailProps) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const itemRefs = useRef<Record<string, Focusable | null>>({});
  const [, forceRefresh] = useReducer((count: number) => count + 1, 0);

  const setItemRef = useCallback(
    (categoryId: string, instance: Focusable | null) => {
      const hadHandle = getHandle(itemRefs.current[categoryId]) !== undefined;
      itemRefs.current[categoryId] = instance;
      registerItemRef?.(categoryId, instance);
      const hasHandle = getHandle(instance) !== undefined;
      if (hadHandle !== hasHandle) {
        requestAnimationFrame(() => forceRefresh());
      }
    },
    [registerItemRef],
  );

  const renderCategoryChip = useCallback(
    ({ item: category, index }: { item: GuideCategoryRailItem; index: number }) => {
      const previous = categories[index - 1];
      const next = categories[index + 1];
      return (
        <GuideCategoryChip
          category={category}
          selected={category.id === selectedCategoryId}
          leftHandle={previous ? getHandle(itemRefs.current[previous.id]) : undefined}
          rightHandle={next ? getHandle(itemRefs.current[next.id]) : undefined}
          onRef={(instance) => setItemRef(category.id, instance)}
          onFocus={() => onFocusChange?.(true)}
          onBlur={() => onFocusChange?.(false)}
          onPress={() => onSelect(category.id)}
        />
      );
    },
    [categories, onFocusChange, onSelect, selectedCategoryId, setItemRef],
  );

  if (!categories.length) {
    return null;
  }

  return (
    <FlatList
      horizontal
      data={categories}
      keyExtractor={(category) => category.renderKey}
      renderItem={renderCategoryChip}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      persistentScrollbar={false}
      style={styles.rail}
      contentContainerStyle={styles.railContent}
      // NOVACAST_GUIDE_V2_FOUNDATION_V1: do not mount hundreds of provider categories at once on Android TV.
      initialNumToRender={16}
      maxToRenderPerBatch={10}
      updateCellsBatchingPeriod={50}
      windowSize={7}
    />
  );
}

function createStyles(theme: NovaTheme) {
  const focusText = createNovaTvFocusTextStyles(theme);
  const focusChrome = createNovaTvFocusChrome(theme);
  return StyleSheet.create({
    rail: { minHeight: 36, maxHeight: 36 },
    railContent: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 2 },
    chipInner: {
      minHeight: 32,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flexShrink: 0,
      borderRadius: 0,
      backgroundColor: 'transparent',
      paddingHorizontal: 8,
      paddingVertical: 4,
      ...focusChrome.base,
    },
    chipInnerSelected: {
      borderBottomWidth: 2,
      borderBottomColor: theme.colors.success,
    },
    chipInnerFocused: focusChrome.active,
    chipName: {
      flexShrink: 0,
      color: theme.colors.textSecondary,
      fontSize: 12,
      fontWeight: '700',
    },
    chipNameSelected: {
      color: theme.colors.textPrimary,
      fontWeight: '800',
    },
    chipNameFocused: focusText.title,
    chipCount: {
      flexShrink: 0,
      color: theme.colors.textMuted,
      fontSize: 10,
      fontWeight: '700',
    },
    chipCountFocused: focusText.count,
  });
}
