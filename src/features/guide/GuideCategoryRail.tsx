import { memo, useCallback, useMemo, useReducer, useRef, useState, type ElementRef } from 'react';
import { findNodeHandle, FlatList, Pressable, StyleSheet, Text } from 'react-native';

import { createNovaTvFocusChrome, createNovaTvFocusTextStyles } from '@/components/nova/novaTvFocus';
import { CATEGORY_REGION_PREFIX_CODES } from '@/features/providers/categoryRegionalConfig';
import { displayProviderCategoryName } from '@/features/providers/categoryDisplay';
import type { ProviderLiveCategory } from '@/features/providers/providerRepositories';
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
  orientation?: 'vertical' | 'horizontal';
};

function getHandle(instance: Focusable | null | undefined) {
  return instance ? findNodeHandle(instance) ?? undefined : undefined;
}

/** Synthetic "smart" buckets rendered as slimmer rows above the provider categories. */
const SMART_CATEGORY_IDS = new Set(['all', 'favorites', 'recent']);

function formatCategoryCount(count: number | null) {
  if (count === null || count < 0) return '';
  return String(count);
}

function splitCountryPrefix(label: string) {
  const match = label.match(/^([A-Z]{2,3})(\s+)(.*)$/);
  if (!match || !CATEGORY_REGION_PREFIX_CODES.has(match[1])) return null;
  return { prefix: match[1], rest: `${match[2]}${match[3]}` };
}

type ChipProps = {
  category: GuideCategoryRailItem;
  selected: boolean;
  leftHandle?: number;
  rightHandle?: number;
  upHandle?: number;
  downHandle?: number;
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
  upHandle,
  downHandle,
}: ChipProps) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [isFocused, setIsFocused] = useState(false);
  const countText = formatCategoryCount(category.count);
  const isSmart = SMART_CATEGORY_IDS.has(category.id);
  const displayName = displayProviderCategoryName({
    name: category.name,
    rawName: category.rawName,
    countryCode: category.countryCode,
    contentType: 'live',
    stripRegionPrefix: false,
  });
  const countryPrefix = splitCountryPrefix(displayName);

  return (
    <Pressable
      ref={onRef}
      focusable
      accessibilityRole="button"
      accessibilityLabel={`Guide category ${category.name}`}
      {...(leftHandle !== undefined ? { nextFocusLeft: leftHandle } : null)}
      {...(rightHandle !== undefined ? { nextFocusRight: rightHandle } : null)}
      {...(upHandle !== undefined ? { nextFocusUp: upHandle } : null)}
      {...(downHandle !== undefined ? { nextFocusDown: downHandle } : null)}
      onFocus={() => {
        setIsFocused(true);
        onFocus();
      }}
      onBlur={() => {
        setIsFocused(false);
        onBlur();
      }}
      onPress={onPress}
      style={[styles.chipInner, isSmart && styles.chipInnerSmart, styles.chipInnerDefault, selected && styles.chipInnerActive, isFocused && (selected ? styles.chipInnerActiveFocused : styles.chipInnerFocused)]}>
      <Text
        numberOfLines={1}
        ellipsizeMode="tail"
        style={[
          styles.chipName,
          selected && styles.chipNameSelected,
          isFocused && styles.chipNameFocused,
        ]}>
        {countryPrefix ? (
          <>
            <Text style={styles.countryPrefix}>{countryPrefix.prefix}</Text>
            <Text>{countryPrefix.rest}</Text>
          </>
        ) : displayName}
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
export function GuideCategoryRail({ categories, selectedCategoryId, onSelect, onFocusChange, registerItemRef, orientation = 'vertical' }: GuideCategoryRailProps) {
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
          leftHandle={orientation === 'horizontal' && previous ? getHandle(itemRefs.current[previous.id]) : undefined}
          rightHandle={orientation === 'horizontal' && next ? getHandle(itemRefs.current[next.id]) : undefined}
          upHandle={orientation === 'vertical' && previous ? getHandle(itemRefs.current[previous.id]) : undefined}
          downHandle={orientation === 'vertical' && next ? getHandle(itemRefs.current[next.id]) : undefined}
          onRef={(instance) => setItemRef(category.id, instance)}
          onFocus={() => onFocusChange?.(true)}
          onBlur={() => onFocusChange?.(false)}
          onPress={() => onSelect(category.id)}
        />
      );
    },
    [categories, onFocusChange, onSelect, orientation, selectedCategoryId, setItemRef],
  );

  if (!categories.length) {
    return null;
  }

  return (
    <FlatList
      horizontal={orientation === 'horizontal'}
      data={categories}
      keyExtractor={(category) => category.renderKey}
      renderItem={renderCategoryChip}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      persistentScrollbar={false}
      style={[styles.rail, orientation === 'vertical' ? styles.railVertical : styles.railHorizontal]}
      contentContainerStyle={[styles.railContent, orientation === 'vertical' ? styles.railContentVertical : null]}
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
  const categoryChrome = StyleSheet.create({
    default: {
      backgroundColor: 'rgba(5, 10, 24, 0.40)',
      borderColor: 'rgba(150, 170, 220, 0.18)',
      borderRadius: 10,
    },
    active: {
      backgroundColor: 'rgba(112, 70, 255, 0.20)',
      borderColor: 'rgba(150, 95, 255, 0.42)',
      borderBottomColor: 'rgba(170, 125, 255, 0.58)',
      borderRadius: 10,
    },
    focused: {
      backgroundColor: 'rgba(112, 70, 255, 0.30)',
      borderColor: 'rgba(150, 95, 255, 0.92)',
      borderRadius: 10,
      shadowColor: '#784DFF',
      shadowOpacity: 0.46,
      shadowRadius: 10,
      elevation: 4,
    },
    activeFocused: {
      backgroundColor: 'rgba(112, 70, 255, 0.35)',
      borderColor: 'rgba(170, 125, 255, 0.98)',
      borderBottomColor: 'rgba(205, 175, 255, 0.82)',
      borderRadius: 10,
      shadowColor: '#784DFF',
      shadowOpacity: 0.55,
      shadowRadius: 12,
      elevation: 5,
    },
  });
  return StyleSheet.create({
    // Base rail no longer caps height; the horizontal variant restores the 36px cap.
    rail: { minHeight: 36 },
    railHorizontal: { maxHeight: 36 },
    railVertical: { minHeight: 0, flex: 1 },
    railContent: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 2 },
    railContentVertical: { flexDirection: 'column', alignItems: 'stretch', paddingHorizontal: 8, paddingVertical: 6, gap: 3 },
    chipInner: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flexShrink: 0,
      backgroundColor: 'transparent',
      paddingHorizontal: 8,
      paddingVertical: 4,
      ...focusChrome.base,
    },
    chipInnerSmart: {
      minHeight: 32,
      paddingVertical: 2,
    },
    chipInnerActive: categoryChrome.active,
    chipInnerDefault: categoryChrome.default,
    chipInnerFocused: categoryChrome.focused,
    chipInnerActiveFocused: categoryChrome.activeFocused,
    chipName: {
      flex: 1,
      flexShrink: 1,
      minWidth: 0,
      color: theme.colors.textSecondary,
      fontSize: 12,
      fontWeight: '700',
    },
    chipNameSelected: {
      color: theme.colors.textPrimary,
      fontWeight: '800',
    },
    chipNameFocused: focusText.title,
    countryPrefix: { color: theme.colors.accentHover, fontWeight: '900' },
    chipCount: {
      flexShrink: 0,
      color: theme.colors.textMuted,
      fontSize: 10,
      fontWeight: '700',
    },
    chipCountFocused: focusText.count,
  });
}
