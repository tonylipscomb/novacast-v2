import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useState } from 'react';

import { novaTvFocus } from '@/components/nova/novaTvFocus';
import { NovaSpaceLoader } from '@/components/nova/NovaSpaceLoader';
import { novaTheme } from '@/theme';

import { SearchPosterCard } from './SearchPosterCard';
import { SearchResults } from './SearchResults';
import { searchResultKey, searchScopeLabel } from './searchScopes';
import type { MovieSearchResult, SearchPageResult, SearchResult, SeriesSearchResult } from './searchTypes';

type SearchSectionProps = {
  scope: SearchResult['type'];
  page: SearchPageResult<SearchResult>;
  loading?: boolean;
  focusedResultKey?: string | null;
  onFocusResult?: (key: string) => void;
  onSelectResult: (result: SearchResult) => void;
  onViewAll?: () => void;
  onFocusViewAll?: () => void;
  focusUpHandle?: number;
  focusLeftHandle?: number;
  firstRowRef?: React.RefObject<View | null>;
};

function isPosterResult(result: SearchResult): result is MovieSearchResult | SeriesSearchResult {
  return result.type === 'movie' || result.type === 'series';
}

function SearchPosterPreviewRow({
  results,
  focusedResultKey,
  onFocusResult,
  onSelectResult,
  focusUpHandle,
  focusLeftHandle,
}: {
  results: SearchResult[];
  focusedResultKey?: string | null;
  onFocusResult?: (key: string) => void;
  onSelectResult: (result: SearchResult) => void;
  focusUpHandle?: number;
  focusLeftHandle?: number;
}) {
  const { width } = useWindowDimensions();
  const cardWidth = width >= 1600 ? 108 : width >= 1280 ? 98 : 88;
  const posterResults = results.filter(isPosterResult);

  return (
    <FlatList
      horizontal
      data={posterResults}
      keyExtractor={(item) => searchResultKey(item)}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.posterRow}
      renderItem={({ item, index }) => {
        const key = searchResultKey(item);
        return (
          <View style={[styles.posterCell, { width: cardWidth }]}>
            <SearchPosterCard
              result={item}
              nextFocusUp={index === 0 ? focusUpHandle : undefined}
              nextFocusLeft={index === 0 ? focusLeftHandle : undefined}
              onFocus={() => onFocusResult?.(key)}
              onPress={() => onSelectResult(item)}
            />
          </View>
        );
      }}
    />
  );
}

export function SearchSection({
  scope,
  page,
  loading = false,
  focusedResultKey,
  onFocusResult,
  onSelectResult,
  onViewAll,
  onFocusViewAll,
  focusUpHandle,
  focusLeftHandle,
  firstRowRef,
}: SearchSectionProps) {
  const [viewAllFocused, setViewAllFocused] = useState(false);

  if (!loading && page.items.length === 0) {
    return null;
  }

  const showViewAll = Boolean(onViewAll && page.hasMore);
  const scopeLabel = searchScopeLabel(scope === 'movie' ? 'movie' : scope);

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.title}>{scopeLabel}</Text>
        <Text style={styles.count}>
          {loading && page.items.length === 0
            ? 'Searching…'
            : `${page.totalCount.toLocaleString()} result${page.totalCount === 1 ? '' : 's'}`}
        </Text>
      </View>

      {loading && page.items.length === 0 ? (
        <NovaSpaceLoader label={`Searching ${scopeLabel.toLowerCase()}…`} variant="inline" />
      ) : scope === 'movie' || scope === 'series' ? (
        <SearchPosterPreviewRow
          results={page.items}
          focusedResultKey={focusedResultKey}
          onFocusResult={onFocusResult}
          onSelectResult={onSelectResult}
          focusUpHandle={focusUpHandle}
          focusLeftHandle={focusLeftHandle}
        />
      ) : (
        <SearchResults
          results={page.items}
          focusedResultKey={focusedResultKey}
          onFocusResult={onFocusResult}
          onSelectResult={onSelectResult}
          emphasized
          focusUpHandle={focusUpHandle}
          focusLeftHandle={focusLeftHandle}
          firstRowRef={firstRowRef}
        />
      )}

      {showViewAll ? (
        <Pressable
          focusable
          accessibilityRole="button"
          accessibilityLabel={`View all ${scopeLabel} results`}
          onPress={onViewAll}
          onFocus={() => {
            setViewAllFocused(true);
            onFocusViewAll?.();
          }}
          onBlur={() => setViewAllFocused(false)}
          {...(focusLeftHandle ? { nextFocusLeft: focusLeftHandle } : null)}
          style={[styles.viewAll, novaTvFocus.base, viewAllFocused && novaTvFocus.active]}>
          <Text style={[styles.viewAllText, viewAllFocused && styles.viewAllTextFocused]}>View all</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 4,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingBottom: 2,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  title: {
    color: novaTheme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  count: {
    color: novaTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  viewAll: {
    alignSelf: 'flex-start',
    minHeight: 28,
    justifyContent: 'center',
    borderRadius: 0,
    paddingHorizontal: 6,
    paddingVertical: 4,
    marginTop: 2,
  },
  viewAllText: {
    color: novaTheme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  viewAllTextFocused: {
    color: novaTheme.colors.textPrimary,
    fontWeight: '800',
  },
  posterRow: {
    gap: novaTheme.density.artworkGap,
    paddingBottom: 4,
  },
  posterCell: {
    minWidth: 0,
  },
});
