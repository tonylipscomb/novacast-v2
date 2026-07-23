import { memo, useCallback, useMemo, useReducer, useRef, useState, type ElementRef } from 'react';
import { findNodeHandle, FlatList, Pressable, StyleSheet, Text } from 'react-native';

import { ProviderCategoryMarker } from '@/components/ProviderCategoryMarker';
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
      initialNumToRender={categories.length}
      windowSize={21}
    />
  );
}

function createStyles(theme: NovaTheme) {
  const light = theme.scheme === 'light';
  return StyleSheet.create({
    rail: { minHeight: 44, maxHeight: 44 },
    railContent: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 2 },
    chipInner: {
      minHeight: 40,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      flexShrink: 0,
      borderRadius: 0,
      borderWidth: 0,
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
      backgroundColor: 'transparent',
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    chipInnerSelected: {
      borderBottomColor: theme.colors.success,
    },
    chipInnerFocused: light
      ? {
          borderBottomColor: theme.colors.focusRing,
          backgroundColor: theme.colors.surfaceFocused,
        }
      : {
          backgroundColor: 'transparent',
        },
    chipName: {
      flexShrink: 0,
      color: theme.colors.textSecondary,
      fontSize: 13,
      fontWeight: '700',
    },
    chipNameSelected: {
      color: theme.colors.textPrimary,
      fontWeight: '800',
    },
    chipNameFocused: light
      ? {
          color: theme.colors.accent,
        }
      : {
          color: theme.colors.accentHover,
          textShadowColor: theme.colors.accentHover,
          textShadowRadius: 8,
        },
    chipCount: {
      flexShrink: 0,
      color: theme.colors.textMuted,
      fontSize: 10,
      fontWeight: '700',
    },
    chipCountFocused: {
      color: light ? theme.colors.accent : theme.colors.accentHover,
    },
  });
}
