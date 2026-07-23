import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { FlatList, StyleSheet, useWindowDimensions, View, type ListRenderItemInfo } from 'react-native';

import { novaTheme } from '@/theme';

import { SearchPosterCard } from './SearchPosterCard';
import { searchResultKey } from './searchScopes';
import type { MovieSearchResult, SearchResult, SeriesSearchResult } from './searchTypes';

type SearchPosterGridProps = {
  results: SearchResult[];
  focusedResultKey?: string | null;
  onFocusResult?: (key: string) => void;
  onSelectResult: (result: SearchResult) => void;
  onEndReached?: () => void;
  loadingMore?: boolean;
  listHeader?: React.ReactNode;
  listFooter?: React.ReactNode;
  focusUpHandle?: number;
  focusLeftHandle?: number;
};

function isPosterResult(result: SearchResult): result is MovieSearchResult | SeriesSearchResult {
  return result.type === 'movie' || result.type === 'series';
}

function getSearchPosterColumns(width: number) {
  if (width >= 1600) {
    return 7;
  }
  if (width >= 1280) {
    return 6;
  }
  return 5;
}

export const SearchPosterGrid = memo(function SearchPosterGrid({
  results,
  focusedResultKey,
  onFocusResult,
  onSelectResult,
  onEndReached,
  loadingMore = false,
  listHeader,
  listFooter,
  focusUpHandle,
  focusLeftHandle,
}: SearchPosterGridProps) {
  const { width } = useWindowDimensions();
  const columns = getSearchPosterColumns(width);
  const posterResults = useMemo(() => results.filter(isPosterResult), [results]);
  const listRef = useRef<FlatList<MovieSearchResult | SeriesSearchResult>>(null);
  const onFocusResultRef = useRef(onFocusResult);
  const onSelectResultRef = useRef(onSelectResult);
  const onEndReachedRef = useRef(onEndReached);
  const lastScrolledIndexRef = useRef<number | null>(null);

  useEffect(() => {
    onFocusResultRef.current = onFocusResult;
    onSelectResultRef.current = onSelectResult;
    onEndReachedRef.current = onEndReached;
  }, [onEndReached, onFocusResult, onSelectResult]);

  const handleFocus = useCallback(
    (key: string, index: number) => {
      onFocusResultRef.current?.(key);
      const row = Math.floor(index / columns);
      if (lastScrolledIndexRef.current === row) {
        return;
      }

      lastScrolledIndexRef.current = row;
      // Keep the focused poster on-screen so Android TV does not drop focus mid-scroll.
      requestAnimationFrame(() => {
        listRef.current?.scrollToIndex({
          index,
          animated: false,
          viewPosition: 0.35,
        });
      });
    },
    [columns],
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<MovieSearchResult | SeriesSearchResult>) => {
      const key = searchResultKey(item);
      const isFirstRow = index < columns;
      const isFirstColumn = index % columns === 0;

      return (
        <View style={styles.cell}>
          <SearchPosterCard
            result={item}
            nextFocusUp={isFirstRow ? focusUpHandle : undefined}
            nextFocusLeft={isFirstColumn ? focusLeftHandle : undefined}
            onFocus={() => handleFocus(key, index)}
            onPress={() => onSelectResultRef.current?.(item)}
          />
        </View>
      );
    },
    [columns, focusLeftHandle, focusUpHandle, handleFocus],
  );

  const keyExtractor = useCallback((item: MovieSearchResult | SeriesSearchResult) => searchResultKey(item), []);

  const listHeaderElement = useMemo(() => (listHeader ? <>{listHeader}</> : null), [listHeader]);
  const listFooterElement = useMemo(() => (listFooter ? <>{listFooter}</> : null), [listFooter]);

  return (
    <FlatList
      ref={listRef}
      data={posterResults}
      numColumns={columns}
      keyExtractor={keyExtractor}
      // Avoid focusedResultKey in extraData — re-rendering the whole grid on every D-pad
      // move drops native TV focus while scrolling through titles.
      extraData={`${columns}:${posterResults.length}:${loadingMore ? 1 : 0}:${focusUpHandle ?? ''}`}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.list}
      columnWrapperStyle={columns > 1 ? styles.row : undefined}
      removeClippedSubviews={false}
      windowSize={7}
      maxToRenderPerBatch={columns * 3}
      updateCellsBatchingPeriod={50}
      initialNumToRender={columns * 3}
      onEndReached={() => {
        if (!loadingMore) {
          onEndReachedRef.current?.();
        }
      }}
      onEndReachedThreshold={0.45}
      onScrollToIndexFailed={(info) => {
        listRef.current?.scrollToOffset({
          offset: Math.max(0, info.averageItemLength * info.index),
          animated: false,
        });
      }}
      ListHeaderComponent={listHeaderElement}
      ListFooterComponent={listFooterElement}
      renderItem={renderItem}
    />
  );
});

const styles = StyleSheet.create({
  list: {
    paddingBottom: 20,
    gap: novaTheme.density.artworkGap,
  },
  row: {
    gap: novaTheme.density.artworkGap,
    marginBottom: novaTheme.density.artworkGap,
  },
  cell: {
    flex: 1,
    minWidth: 0,
  },
});
