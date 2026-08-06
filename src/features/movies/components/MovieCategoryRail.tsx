import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState, type ElementRef } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { isProviderCategory } from '@/features/media-browser/mediaCategoryUtils';
import {
  isOnnMoviesTraceEnabled,
  noteOnnMoviesMount,
  noteOnnMoviesRender,
  noteOnnMoviesUnmount,
} from '@/features/diagnostics/onnMoviesTrace';
import { recordFocusAudit } from '@/features/navigation/focusRequestAudit';
import { ProviderCategoryMarker } from '@/components/ProviderCategoryMarker';
import { createNovaTvFocusTextStyles, createNovaTvFocusChrome } from '@/components/nova/novaTvFocus';
import { displayProviderCategoryName } from '@/features/providers/categoryDisplay';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaTheme } from '@/theme/tokens';

import type { ProviderCategoryContentType } from '@/features/providers/categoryNormalization';

import type { MovieCategory } from '../movieTypes';
import { formatMovieCategoryCount } from '../movieCategoryCountPolicy';

const PROVIDER_SECTION_ID = 'section:provider';
const DISCOVER_SECTION_ID = 'section:discover';

type MovieCategoryRailProps = {
  categories: MovieCategory[];
  selectedCategoryId: string;
  preferredCategoryId?: string | null;
  suppressPreferredFocus?: boolean;
  focusable?: boolean;
  discoverStatusMessage?: string | null;
  contentType?: ProviderCategoryContentType;
  /** Stage 4.2K.1: stable diagnostics identity — must not be used as a React key. */
  railInstanceId?: string;
  onSelectCategory: (categoryId: string) => void;
  onPrefetchCategoryCount?: (categoryId: string, kind?: MovieCategory['kind']) => void;
  registerItemRef?: (categoryId: string, instance: ElementRef<typeof Pressable> | null) => void;
  nextFocusRightHandle?: number;
};

export function MovieCategoryRail({
  categories,
  selectedCategoryId,
  preferredCategoryId,
  suppressPreferredFocus = false,
  focusable = true,
  discoverStatusMessage,
  contentType = 'movie',
  railInstanceId,
  onSelectCategory,
  onPrefetchCategoryCount,
  registerItemRef,
  nextFocusRightHandle,
}: MovieCategoryRailProps) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [focusedCategoryId, setFocusedCategoryId] = useState<string | null>(null);
  const preferredFocusConsumedRef = useRef(false);
  const initialPreferredCategoryIdRef = useRef(preferredCategoryId);

  if (isOnnMoviesTraceEnabled()) {
    noteOnnMoviesRender('MovieCategoryRail');
  }

  useEffect(() => {
    if (!isOnnMoviesTraceEnabled()) {
      return;
    }
    noteOnnMoviesMount('MovieCategoryRail', {
      categoryCount: categories.length,
      railInstanceId: railInstanceId ?? null,
    });
    return () => {
      noteOnnMoviesUnmount('MovieCategoryRail', {
        categoryCount: categories.length,
        railInstanceId: railInstanceId ?? null,
      });
    };
    // Stage 4.2K.1: identity is railInstanceId — do not remount on categoryCount/detail phase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [railInstanceId]);

  return (
    <View style={styles.panel} collapsable={false}>
      <View style={styles.header}>
        <Text style={styles.title}>Categories</Text>
        <MaterialCommunityIcons name="view-list-outline" size={18} color={theme.colors.textMuted} />
      </View>

      {discoverStatusMessage ? (
        <View style={styles.discoverStatusSlot}>
          <View style={styles.discoverStatus}>
            <Text style={styles.discoverStatusText}>{discoverStatusMessage}</Text>
          </View>
        </View>
      ) : null}

      <FlatList
        data={categories}
        keyExtractor={(item) => item.renderKey}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.list}
        style={styles.listContainer}
        removeClippedSubviews={false}
        initialNumToRender={Math.min(categories.length, 10)}
        maxToRenderPerBatch={6}
        windowSize={3}
        renderItem={({ item }) => {
          if (item.kind === 'section') {
            if (item.id === PROVIDER_SECTION_ID) {
              return (
                <View style={styles.providerSeparator}>
                  <View style={styles.providerSeparatorLine} />
                </View>
              );
            }

            return (
              <View style={[styles.sectionRow, item.id === DISCOVER_SECTION_ID && styles.sectionRowFirst]}>
                <Text style={styles.sectionLabel}>{item.name}</Text>
              </View>
            );
          }

          const selected = item.id === selectedCategoryId;
          const focused = focusedCategoryId === item.id;
          const displayName = displayProviderCategoryName({
            name: item.name,
            rawName: item.rawName,
            countryCode: item.countryCode,
            contentType,
            kind: item.kind,
          });
          const countryCode = item.countryCode;
          const regionMarker = item.regionMarker;
          const showMarker = isProviderCategory(item) && (Boolean(countryCode) || regionMarker === 'multi');

          const preferInitialFocus =
            !suppressPreferredFocus &&
            !preferredFocusConsumedRef.current &&
            Boolean(initialPreferredCategoryIdRef.current && item.id === initialPreferredCategoryIdRef.current);
          const isSmartCategory = item.kind === 'smart';

          if (preferInitialFocus) {
            recordFocusAudit({
              component: 'MovieCategoryRail',
              action: 'hasTVPreferredFocus',
              itemId: item.id,
            });
          }

          return (
            <Pressable
              ref={(instance) => registerItemRef?.(item.id, instance)}
              focusable={focusable}
              disabled={!focusable}
              hasTVPreferredFocus={preferInitialFocus}
              {...(selected && nextFocusRightHandle ? { nextFocusRight: nextFocusRightHandle } : null)}
              onFocus={() => {
                recordFocusAudit({ component: 'MovieCategoryRail', action: 'focus-received', itemId: item.id });
                preferredFocusConsumedRef.current = true;
                setFocusedCategoryId(item.id);
                onPrefetchCategoryCount?.(item.id, item.kind);
              }}
              onBlur={() => setFocusedCategoryId(null)}
              onPress={() => onSelectCategory(item.id)}
              style={[
                styles.row,
                isSmartCategory && styles.rowSmart,
                selected && styles.rowSelected,
                focused && styles.rowFocused,
              ]}>
              {showMarker ? (
                <ProviderCategoryMarker
                  countryCode={countryCode}
                  regionMarker={regionMarker}
                  size="md"
                />
              ) : null}
              <Text
                numberOfLines={2}
                ellipsizeMode="tail"
                style={[
                  styles.name,
                  selected && styles.nameSelected,
                  focused && styles.nameFocused,
                ]}>
                {displayName}
              </Text>
              <Text
                style={[
                  styles.count,
                  selected && styles.countSelected,
                  focused && styles.countFocused,
                ]}>
                {formatMovieCategoryCount(item.count, item.countKnown)}
              </Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

function createStyles(theme: NovaTheme) {
  const focusText = createNovaTvFocusTextStyles(theme);
  const focusChrome = createNovaTvFocusChrome(theme);
  return StyleSheet.create({
    panel: {
      width: 260,
      minWidth: 260,
      maxWidth: 260,
      flexShrink: 0,
      flex: 1,
      minHeight: 0,
      borderRadius: 0,
      borderRightWidth: 1,
      borderRightColor: theme.colors.borderSubtle,
      backgroundColor: 'transparent',
      padding: 0,
      paddingRight: 10,
    },
    header: {
      minHeight: 32,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 6,
      marginBottom: 2,
    },
    title: {
      color: theme.colors.textPrimary,
      fontSize: 18,
      fontWeight: '800',
    },
    list: {
      gap: 0,
      paddingTop: 0,
      paddingBottom: 8,
    },
    listContainer: {
      flex: 1,
      minHeight: 0,
    },
    row: {
      minHeight: 40,
      borderRadius: 0,
      backgroundColor: 'transparent',
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.borderSubtle,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 6,
      paddingHorizontal: 8,
      paddingVertical: 4,
      ...focusChrome.base,
    },
    rowSelected: {
      borderBottomColor: theme.colors.success,
    },
    rowFocused: focusChrome.active,
    rowSmart: {
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.borderSubtle,
    },
    name: {
      flex: 1,
      minWidth: 0,
      color: theme.colors.textPrimary,
      fontSize: 13,
      fontWeight: '700',
      lineHeight: 16,
    },
    nameSelected: {
      color: theme.colors.textPrimary,
      fontWeight: '800',
    },
    nameFocused: {
      ...focusText.title,
      fontSize: 15,
      lineHeight: 18,
    },
    count: {
      flexShrink: 0,
      minWidth: 32,
      textAlign: 'right',
      color: theme.colors.textSecondary,
      fontSize: 11,
      fontWeight: '700',
    },
    countSelected: {
      color: theme.colors.textPrimary,
    },
    countFocused: {
      ...focusText.count,
      fontSize: 13,
    },
    sectionRow: {
      minHeight: 24,
      justifyContent: 'center',
      paddingHorizontal: 8,
      paddingVertical: 2,
      marginTop: 2,
    },
    sectionRowFirst: {
      minHeight: 22,
      marginTop: 0,
      paddingTop: 0,
    },
    sectionLabel: {
      color: theme.colors.textSecondary,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    discoverStatusSlot: {
      justifyContent: 'center',
      marginBottom: 2,
    },
    discoverStatus: {
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.borderSubtle,
      backgroundColor: theme.colors.surfaceMuted,
      paddingHorizontal: 8,
      paddingVertical: 5,
    },
    discoverStatusText: {
      color: theme.colors.accent,
      fontSize: 11,
      fontWeight: '700',
    },
    providerSeparator: {
      minHeight: 10,
      justifyContent: 'center',
      paddingHorizontal: 6,
      marginTop: 2,
      marginBottom: 0,
    },
    providerSeparatorLine: {
      height: 1,
      borderRadius: 1,
      backgroundColor: theme.colors.borderStrong,
    },
  });
}
