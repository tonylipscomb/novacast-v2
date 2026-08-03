import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  FlatList,
  StyleSheet,
  useWindowDimensions,
  View,
  type ListRenderItemInfo,
  type ViewToken,
} from 'react-native';

import { novaTheme } from '@/theme';

import {
  getActiveMoviesSearchRequestId,
  markMoviesSearchFirstRender,
  setMoviesSearchFirstBatchCount,
} from './moviesSearchPerfDiagnostics';
import {
  decideMoviesSearchScrollExecution,
  itemIndexToMoviesSearchScrollRow,
  logMoviesSearchScroll,
  type PendingMoviesSearchScroll,
} from './moviesSearchScroll';
import { SearchPosterCard } from './SearchPosterCard';
import { searchResultKey } from './searchScopes';
import type { MovieSearchResult, SearchResult, SeriesSearchResult } from './searchTypes';

type SearchPosterGridProps = {
  results: SearchResult[];
  focusedResultKey?: string | null;
  focusedMovieId?: string | null;
  searchQuery?: string;
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
  focusedMovieId = null,
  searchQuery = '',
  onFocusResult,
  onSelectResult,
  onEndReached,
  loadingMore = false,
  listHeader,
  listFooter,
  focusUpHandle,
  focusLeftHandle,
}: SearchPosterGridProps) {
  void focusedResultKey;
  const { width } = useWindowDimensions();
  const columns = getSearchPosterColumns(width);
  const posterResults = useMemo(() => results.filter(isPosterResult), [results]);
  const listRef = useRef<FlatList<MovieSearchResult | SeriesSearchResult>>(null);
  const onFocusResultRef = useRef(onFocusResult);
  const onSelectResultRef = useRef(onSelectResult);
  const onEndReachedRef = useRef(onEndReached);
  const lastScrolledRowRef = useRef<number | null>(null);
  const posterResultsRef = useRef(posterResults);
  const columnsRef = useRef(columns);
  const queryRevisionRef = useRef(0);
  const pendingScrollRef = useRef<PendingMoviesSearchScroll | null>(null);
  const cellsReadyThroughRowRef = useRef<number | null>(0);
  const rafRef = useRef<number | null>(null);

  posterResultsRef.current = posterResults;
  columnsRef.current = columns;

  useEffect(() => {
    onFocusResultRef.current = onFocusResult;
    onSelectResultRef.current = onSelectResult;
    onEndReachedRef.current = onEndReached;
  }, [onEndReached, onFocusResult, onSelectResult]);

  // New result set / query → bump revision and drop any stale pending scroll.
  useEffect(() => {
    queryRevisionRef.current += 1;
    lastScrolledRowRef.current = null;
    cellsReadyThroughRowRef.current = 0;
    if (pendingScrollRef.current) {
      logMoviesSearchScroll({
        requestId: pendingScrollRef.current.requestId,
        queryRevision: pendingScrollRef.current.queryRevision,
        requestedIndex: pendingScrollRef.current.rowIndex,
        currentLength: Math.ceil(posterResults.length / Math.max(1, columns)),
        executed: false,
        dropped: true,
        reason: 'results-replaced',
      });
      pendingScrollRef.current = null;
    }
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, [columns, posterResults, searchQuery]);

  useEffect(() => {
    if (!posterResults.length) {
      return;
    }
    const requestId = getActiveMoviesSearchRequestId();
    if (!requestId) {
      return;
    }
    setMoviesSearchFirstBatchCount(requestId, Math.min(posterResults.length, columns * 3));
    markMoviesSearchFirstRender(requestId, posterResults.length);
  }, [columns, posterResults]);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
      }
      pendingScrollRef.current = null;
    };
  }, []);

  const executePendingScroll = useCallback((source: string) => {
    const pending = pendingScrollRef.current;
    const activeRequestId = getActiveMoviesSearchRequestId();
    const decision = decideMoviesSearchScrollExecution({
      pending,
      activeRequestId,
      activeQueryRevision: queryRevisionRef.current,
      itemCount: posterResultsRef.current.length,
      columns: columnsRef.current,
      cellsReadyThroughRow: cellsReadyThroughRowRef.current,
    });

    if (decision.action === 'drop') {
      if (pending) {
        logMoviesSearchScroll({
          requestId: pending.requestId,
          queryRevision: pending.queryRevision,
          requestedIndex: pending.rowIndex,
          currentLength: decision.listLength,
          executed: false,
          dropped: true,
          reason: decision.reason,
        });
      }
      pendingScrollRef.current = null;
      return;
    }

    if (decision.action === 'wait') {
      logMoviesSearchScroll({
        requestId: pending?.requestId ?? null,
        queryRevision: pending?.queryRevision ?? queryRevisionRef.current,
        requestedIndex: decision.rowIndex,
        currentLength: decision.listLength,
        executed: false,
        dropped: false,
        reason: `${decision.reason}:${source}`,
      });
      return;
    }

    // action === 'execute'
    const requestId = pending?.requestId ?? activeRequestId;
    const queryRevision = pending?.queryRevision ?? queryRevisionRef.current;
    pendingScrollRef.current = null;

    try {
      listRef.current?.scrollToIndex({
        index: decision.rowIndex,
        animated: false,
        viewPosition: 0.35,
      });
      logMoviesSearchScroll({
        requestId,
        queryRevision,
        requestedIndex: decision.rowIndex,
        currentLength: decision.listLength,
        executed: true,
        dropped: false,
        reason: source,
      });
    } catch (error) {
      logMoviesSearchScroll({
        requestId,
        queryRevision,
        requestedIndex: decision.rowIndex,
        currentLength: decision.listLength,
        executed: false,
        dropped: true,
        reason: `scroll-threw:${error instanceof Error ? error.message : String(error)}`,
      });
      // Do not retry invalid / thrown scrolls.
    }
  }, []);

  const scheduleScrollToFocusedItem = useCallback(
    (itemIndex: number, reason: string) => {
      const columnsNow = columnsRef.current;
      const rowIndex = itemIndexToMoviesSearchScrollRow(itemIndex, columnsNow);
      const requestId = getActiveMoviesSearchRequestId();
      const queryRevision = queryRevisionRef.current;

      if (lastScrolledRowRef.current === rowIndex) {
        return;
      }
      lastScrolledRowRef.current = rowIndex;

      // Focus proves this row's cell is mounted — do not wait on viewability for it.
      cellsReadyThroughRowRef.current = Math.max(cellsReadyThroughRowRef.current ?? 0, rowIndex);

      pendingScrollRef.current = {
        requestId,
        queryRevision,
        rowIndex,
        reason,
      };

      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        executePendingScroll(reason);
      });
    },
    [executePendingScroll],
  );

  const handleFocus = useCallback(
    (key: string, index: number) => {
      onFocusResultRef.current?.(key);
      scheduleScrollToFocusedItem(index, 'focus-keep-visible');
    },
    [scheduleScrollToFocusedItem],
  );

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    let maxRow = cellsReadyThroughRowRef.current ?? 0;
    for (const token of viewableItems) {
      if (typeof token.index === 'number' && token.index >= 0) {
        const row = itemIndexToMoviesSearchScrollRow(token.index, columnsRef.current);
        if (row > maxRow) {
          maxRow = row;
        }
      }
    }
    cellsReadyThroughRowRef.current = maxRow;
    if (pendingScrollRef.current) {
      executePendingScroll('viewable-items');
    }
  }).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 10,
    minimumViewTime: 0,
  }).current;

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<MovieSearchResult | SeriesSearchResult>) => {
      const key = searchResultKey(item);
      const isFirstRow = index < columns;
      const isFirstColumn = index % columns === 0;
      const focused =
        item.type === 'movie' ? focusedMovieId === item.id : focusedResultKey === key;

      return (
        <View style={styles.cell}>
          <SearchPosterCard
            result={item}
            focused={focused}
            searchQuery={searchQuery}
            nextFocusUp={isFirstRow ? focusUpHandle : undefined}
            nextFocusLeft={isFirstColumn ? focusLeftHandle : undefined}
            onFocus={() => handleFocus(key, index)}
            onPress={() => onSelectResultRef.current?.(item)}
          />
        </View>
      );
    },
    [columns, focusLeftHandle, focusUpHandle, focusedMovieId, focusedResultKey, handleFocus, searchQuery],
  );

  const keyExtractor = useCallback((item: MovieSearchResult | SeriesSearchResult) => searchResultKey(item), []);

  const listHeaderElement = useMemo(() => (listHeader ? <>{listHeader}</> : null), [listHeader]);
  const listFooterElement = useMemo(() => (listFooter ? <>{listFooter}</> : null), [listFooter]);

  return (
    <FlatList
      ref={listRef}
      key="search-poster-grid"
      data={posterResults}
      numColumns={columns}
      keyExtractor={keyExtractor}
      // Only the focused movie id — avoid remounting every card on each D-pad move.
      extraData={`${columns}:${posterResults.length}:${loadingMore ? 1 : 0}:${focusedMovieId ?? ''}`}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.list}
      columnWrapperStyle={columns > 1 ? styles.row : undefined}
      removeClippedSubviews={false}
      windowSize={5}
      maxToRenderPerBatch={columns * 2}
      updateCellsBatchingPeriod={50}
      initialNumToRender={Math.min(columns * 2, 12)}
      onEndReached={() => {
        if (!loadingMore) {
          onEndReachedRef.current?.();
        }
      }}
      onEndReachedThreshold={0.45}
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={viewabilityConfig}
      onLayout={() => {
        if (pendingScrollRef.current) {
          executePendingScroll('layout');
        }
      }}
      onScrollToIndexFailed={(info) => {
        // Stage 3G.1: never blindly scrollToOffset with a stale/out-of-range index.
        // Drop — do not retry.
        const activeRequestId = getActiveMoviesSearchRequestId();
        const listLength = Math.ceil(posterResultsRef.current.length / Math.max(1, columnsRef.current));
        logMoviesSearchScroll({
          requestId: activeRequestId,
          queryRevision: queryRevisionRef.current,
          requestedIndex: info.index,
          currentLength: listLength,
          executed: false,
          dropped: true,
          reason: 'scroll-to-index-failed-no-retry',
        });
        pendingScrollRef.current = null;
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
