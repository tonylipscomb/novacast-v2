import type { ElementRef } from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { FlatList, StyleSheet, Text, View, useWindowDimensions, type ListRenderItemInfo, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useAppTheme, type NovaTheme } from '@/theme';
import { NovaSpaceLoader } from '@/components/nova/NovaSpaceLoader';
import { shouldAutoFocusSortControl, shouldClaimPreferredPosterFocus, isLastPosterRow } from '@/features/media-browser/posterGridFocusPolicy';
import { ContentSortControl, type ContentSortControlHandle } from '@/features/media-browser/ContentSortControl';
import type { ContentSortOption } from '@/features/media-browser/contentSorting';
import { estimatePosterRowHeight, TV_POSTER_LIST_TUNING } from '@/features/media-browser/tvPosterListTuning';
import { tvPerfRecordPosterRender, tvPerfSetVisiblePosters } from '@/features/perf/tvPerfStore';

import type { MovieSummary } from '../movieTypes';
import { getMoviesDetailOpenForDiagnostics } from '../moviesDiagnosticsState';
import { MoviePosterCard } from './MoviePosterCard';
import { recordFocusAudit } from '@/features/navigation/focusRequestAudit';

type MoviePosterGridProps = {
  movies: MovieSummary[];
  selectedCategoryLabel: string;
  selectedCategoryId: string;
  columns: number;
  hasMore: boolean;
  loading: boolean;
  categoryLoading?: boolean;
  selectedMovieId: string | null;
  postersFocusable?: boolean;
  onFocusMovie: (movie: MovieSummary) => void;
  onSelectMovie: (movie: MovieSummary) => void;
  registerPosterRef?: (movieId: string, instance: ElementRef<typeof View> | null, instanceToken: string, renderedIndex: number) => void;
  loadMore: () => void | Promise<void>;
  sortOption: ContentSortOption;
  onSortChange: (value: ContentSortOption) => void;
  showRatingSort?: boolean;
  isDiscover?: boolean;
  emptyNotice?: string | null;
  sortFocusLeftHandle?: number;
  onSortFocusHandleReady?: (handle: number | undefined) => void;
  restoreMovieId?: string | null;
  restoreMovieIndex?: number | null;
  restoreScrollOffset?: number | null;
  restoreVisibleFirstIndex?: number | null;
  restoreVisibleLastIndex?: number | null;
  restorationToken?: string | null;
  /** Stage 3D: after exact confirm, block any further restore scrolls. */
  restoreScrollBlocked?: boolean;
  /**
   * Stage 3D.1: restore exact saved offset via scrollToOffset (never top-row align).
   * `initial` once per close; `corrective` at most once after focus drift.
   */
  viewportRestoreCommand?: {
    token: string;
    offset: number;
    reason: 'initial' | 'corrective';
  } | null;
  /** Stage 3D: during closing, only this poster may be focusable. */
  closingFocusMovieId?: string | null;
  /** When true, snapshot said target was visible — do not use index positioning. */
  snapshotTargetWasVisible?: boolean;
  onViewportChange?: (state: { offset: number; firstIndex: number | null; lastIndex: number | null }) => void;
  suppressPreferredFocus?: boolean;
};

export function MoviePosterGrid({
  movies,
  selectedCategoryLabel,
  selectedCategoryId,
  columns,
  hasMore,
  loading,
  categoryLoading = false,
  selectedMovieId,
  postersFocusable = true,
  onFocusMovie,
  onSelectMovie,
  registerPosterRef,
  loadMore,
  sortOption,
  onSortChange,
  showRatingSort = true,
  isDiscover = false,
  emptyNotice = null,
  sortFocusLeftHandle,
  onSortFocusHandleReady,
  restoreMovieId = null,
  restoreMovieIndex = null,
  restoreScrollOffset = null,
  restoreVisibleFirstIndex = null,
  restoreVisibleLastIndex = null,
  restorationToken = null,
  restoreScrollBlocked = false,
  viewportRestoreCommand = null,
  closingFocusMovieId = null,
  snapshotTargetWasVisible = false,
  onViewportChange,
  suppressPreferredFocus = false,
}: MoviePosterGridProps) {
  const gridHeaderSuffix = `${movies.length} items`;
  const firstMovieId = movies[0]?.id;
  const focusSeedRef = useRef<string | null>(null);
  const focusClaimedRef = useRef(false);
  const firstCardRef = useRef<ElementRef<typeof View> | null>(null);
  const sortControlRef = useRef<ContentSortControlHandle | null>(null);
  const sortMountedRef = useRef(false);
  const loadMoreInFlightRef = useRef(false);
  const onFocusMovieRef = useRef(onFocusMovie);
  const onSelectMovieRef = useRef(onSelectMovie);
  const registerPosterRefRef = useRef(registerPosterRef);
  const previousMoviesDataRef = useRef<MovieSummary[] | null>(null);
  const moviesDiagnosticsRef = useRef<MovieSummary[]>(movies);
  const restorationTokenDiagnosticsRef = useRef<string | null>(restorationToken);
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<MovieSummary> | null>(null);
  const currentOffsetRef = useRef(0);
  const visibleRangeRef = useRef({ firstIndex: null as number | null, lastIndex: null as number | null });
  const restorationScrollIssuedRef = useRef<string | null>(null);
  const viewportRestoreIssuedKeyRef = useRef<string | null>(null);

  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  onFocusMovieRef.current = onFocusMovie;
  onSelectMovieRef.current = onSelectMovie;
  registerPosterRefRef.current = registerPosterRef;
  // Diagnostics-only mirrors so lifecycle logs can report current values
  // without widening the mount/unmount effect dependencies.
  moviesDiagnosticsRef.current = movies;
  restorationTokenDiagnosticsRef.current = restorationToken;

  useEffect(() => {
    const previous = previousMoviesDataRef.current;
    console.info(
      '[NovaCast Movies FlatList Data] ' +
        JSON.stringify({
          reason: previous == null ? 'initial-data' : previous === movies ? 'same-array-render' : 'data-array-replaced',
          arrayIdentityChanged: previous != null && previous !== movies,
          previousLength: previous?.length ?? null,
          nextLength: movies.length,
          previousFirstId: previous?.[0]?.id ?? null,
          nextFirstId: movies[0]?.id ?? null,
          previousLastId: previous?.[previous.length - 1]?.id ?? null,
          nextLastId: movies[movies.length - 1]?.id ?? null,
          flatListKey: columns,
        }),
    );
    previousMoviesDataRef.current = movies;
  }, [columns, movies]);

  useEffect(() => {
    console.info(
      '[NovaCast Movies FlatList] ' +
        JSON.stringify({
          action: 'mounted',
          key: columns,
          rowCount: moviesDiagnosticsRef.current.length,
          firstId: moviesDiagnosticsRef.current[0]?.id ?? null,
          lastId: moviesDiagnosticsRef.current[moviesDiagnosticsRef.current.length - 1]?.id ?? null,
          detailOpen: getMoviesDetailOpenForDiagnostics(),
          restorationActive: Boolean(restorationTokenDiagnosticsRef.current),
        }),
    );
    return () => {
      console.info(
        '[NovaCast Movies FlatList] ' +
          JSON.stringify({
            action: 'unmounted',
            key: columns,
            rowCount: moviesDiagnosticsRef.current.length,
            firstId: moviesDiagnosticsRef.current[0]?.id ?? null,
            lastId: moviesDiagnosticsRef.current[moviesDiagnosticsRef.current.length - 1]?.id ?? null,
            detailOpen: getMoviesDetailOpenForDiagnostics(),
            restorationActive: Boolean(restorationTokenDiagnosticsRef.current),
          }),
      );
    };
  }, [columns]);

  const handleFocusMovie = useCallback((movie: MovieSummary) => {
    focusClaimedRef.current = true;
    onFocusMovieRef.current(movie);
  }, []);

  const handleSelectMovie = useCallback((movie: MovieSummary) => {
    onSelectMovieRef.current(movie);
  }, []);

  const handleRegisterRef = useCallback(
    (movieId: string, renderedIndex: number, instance: ElementRef<typeof View> | null, instanceToken: string) => {
      if (movieId === firstMovieId) {
        firstCardRef.current = instance;
      }
      registerPosterRefRef.current?.(movieId, instance, instanceToken, renderedIndex);
    },
    [firstMovieId],
  );

  const requestMore = useCallback(() => {
    if (!hasMore || loading || loadMoreInFlightRef.current) {
      return;
    }

    loadMoreInFlightRef.current = true;
    Promise.resolve(loadMore())
      .catch(() => {
        // The screen model owns user-facing pagination errors.
      })
      .finally(() => {
        loadMoreInFlightRef.current = false;
      });
  }, [hasMore, loadMore, loading]);

  useEffect(() => {
    focusClaimedRef.current = false;
    focusSeedRef.current = selectedMovieId ?? firstMovieId ?? null;
  }, [firstMovieId, selectedCategoryId, selectedMovieId]);

  useEffect(() => {
    if (!sortMountedRef.current) {
      sortMountedRef.current = true;
      return;
    }

    if (!shouldAutoFocusSortControl({ sortOptionChanged: true, loadingChanged: false })) {
      return;
    }

    requestAnimationFrame(() => {
      recordFocusAudit({ component: 'MoviePosterGrid', action: 'requestFocus', reason: 'sort-option-changed' });
      sortControlRef.current?.focus();
    });
  }, [sortOption]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      onSortFocusHandleReady?.(sortControlRef.current?.getFocusHandle());
    });
    return () => cancelAnimationFrame(frame);
  }, [onSortFocusHandleReady, selectedCategoryId, sortOption]);

  useEffect(() => {
    tvPerfSetVisiblePosters(Math.min(movies.length, columns * TV_POSTER_LIST_TUNING.windowSize));
  }, [columns, movies.length]);

  // Stage 3D.1: viewport-first restore via exact saved offset (never top-row align).
  useEffect(() => {
    if (restoreScrollBlocked || !viewportRestoreCommand) {
      return;
    }
    const commandKey = `${viewportRestoreCommand.token}:${viewportRestoreCommand.reason}`;
    if (viewportRestoreIssuedKeyRef.current === commandKey) {
      return;
    }
    viewportRestoreIssuedKeyRef.current = commandKey;

    const offset = Math.max(0, viewportRestoreCommand.offset);
    try {
      console.info(
        '[NovaCast Movies Scroll Command] ' +
          JSON.stringify({
            token: viewportRestoreCommand.token,
            source:
              viewportRestoreCommand.reason === 'corrective'
                ? 'detail-restoration-corrective-offset'
                : 'detail-restoration-saved-offset',
            method: 'scrollToOffset',
            requestedIndex: restoreMovieIndex,
            requestedOffset: offset,
            currentOffset: currentOffsetRef.current,
            focusedMovieId: selectedMovieId,
            restorationActive: true,
            timestamp: Date.now(),
          }),
      );
      listRef.current?.scrollToOffset({ offset, animated: false });
      console.info(
        '[NovaCast Movies Viewport Restore] ' +
          JSON.stringify({
            token: viewportRestoreCommand.token,
            targetMovieId: restoreMovieId,
            targetIndex: restoreMovieIndex,
            savedOffset: offset,
            currentOffset: currentOffsetRef.current,
            visibleFirstIndex: restoreVisibleFirstIndex,
            visibleLastIndex: restoreVisibleLastIndex,
            targetVisible: snapshotTargetWasVisible,
            focusConfirmed: false,
            highlightVisible: false,
            outcome:
              viewportRestoreCommand.reason === 'corrective'
                ? 'corrective-offset-restore'
                : 'scrolled-to-saved-offset',
          }),
      );
    } catch {
      // List may not be measured yet; coordinator retries via restorationRetry.
      viewportRestoreIssuedKeyRef.current = null;
    }
  }, [
    restoreMovieId,
    restoreMovieIndex,
    restoreScrollBlocked,
    restoreVisibleFirstIndex,
    restoreVisibleLastIndex,
    selectedMovieId,
    snapshotTargetWasVisible,
    viewportRestoreCommand,
  ]);

  // Offscreen-at-open fallback: restore the saved window with offset only.
  // Never top-row-align the target. Snapshot-visible targets must not use
  // index positioning even if live viewability is stale.
  useEffect(() => {
    if (
      restoreScrollBlocked ||
      viewportRestoreCommand ||
      snapshotTargetWasVisible ||
      !restorationToken ||
      !restoreMovieId ||
      restoreMovieIndex == null ||
      restoreMovieIndex < 0 ||
      restoreScrollOffset == null
    ) {
      return;
    }
    if (restorationScrollIssuedRef.current === restorationToken) {
      return;
    }
    restorationScrollIssuedRef.current = restorationToken;
    const offset = Math.max(0, restoreScrollOffset);
    try {
      console.info(
        '[NovaCast Movies Scroll Command] ' +
          JSON.stringify({
            token: restorationToken,
            source: 'detail-restoration-offscreen-saved-offset',
            method: 'scrollToOffset',
            requestedIndex: restoreMovieIndex,
            requestedOffset: offset,
            currentOffset: currentOffsetRef.current,
            focusedMovieId: selectedMovieId,
            restorationActive: true,
            timestamp: Date.now(),
          }),
      );
      listRef.current?.scrollToOffset({ offset, animated: false });
    } catch {
      restorationScrollIssuedRef.current = null;
    }
  }, [
    restoreMovieId,
    restoreMovieIndex,
    restoreScrollBlocked,
    restoreScrollOffset,
    restorationToken,
    selectedMovieId,
    snapshotTargetWasVisible,
    viewportRestoreCommand,
  ]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = Math.max(0, event.nativeEvent.contentOffset.y);
    currentOffsetRef.current = offset;
    onViewportChange?.({ offset, ...visibleRangeRef.current });
  }, [onViewportChange]);

  const handleViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: Array<{ index: number | null }> }) => {
    const indices = viewableItems.map((entry) => entry.index).filter((index): index is number => index != null);
    visibleRangeRef.current = {
      firstIndex: indices.length ? Math.min(...indices) : null,
      lastIndex: indices.length ? Math.max(...indices) : null,
    };
    onViewportChange?.({ offset: currentOffsetRef.current, ...visibleRangeRef.current });
  }).current;

  const columnWidth = useMemo(() => {
    const usable = Math.max(240, width - 320);
    return usable / Math.max(1, columns);
  }, [columns, width]);

  const rowHeight = useMemo(() => estimatePosterRowHeight(columnWidth), [columnWidth]);

  const getItemLayout = useCallback(
    (_data: ArrayLike<MovieSummary> | null | undefined, index: number) => {
      const rowIndex = Math.floor(index / Math.max(1, columns));
      return {
        length: rowHeight,
        offset: rowHeight * rowIndex,
        index,
      };
    },
    [columns, rowHeight],
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<MovieSummary>) => {
      tvPerfRecordPosterRender();
      return (
        <MoviePosterCard
          movie={item}
          isDiscover={isDiscover}
          focusable={
            postersFocusable || (closingFocusMovieId != null && closingFocusMovieId === item.id)
          }
          trapFocusDown={isLastPosterRow({ index, itemCount: movies.length, columns })}
          hasPreferredFocus={
            // Stage 3D: never let first-poster preferred focus compete during close.
            closingFocusMovieId != null || suppressPreferredFocus
              ? false
              : shouldClaimPreferredPosterFocus({
                  focusClaimed: focusClaimedRef.current || selectedMovieId != null,
                  itemId: item.id,
                  seedId: focusSeedRef.current,
                })
          }
          onFocus={handleFocusMovie}
          onPress={handleSelectMovie}
          registerRef={(instance, instanceToken) => handleRegisterRef(item.id, index, instance, instanceToken)}
        />
      );
    },
    [
      closingFocusMovieId,
      columns,
      handleFocusMovie,
      handleRegisterRef,
      handleSelectMovie,
      isDiscover,
      movies.length,
      postersFocusable,
      selectedMovieId,
      suppressPreferredFocus,
    ],
  );

  const keyExtractor = useCallback((item: MovieSummary) => item.id, []);

  const loadingLabel = `Loading ${selectedCategoryLabel}â€¦`;
  const showInitialLoader = categoryLoading && movies.length === 0 && !emptyNotice;
  const showCategoryLoadingOverlay = categoryLoading && movies.length > 0;

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text numberOfLines={1} style={styles.title}>
          {selectedCategoryLabel}
        </Text>
        <View style={styles.sortGroup}>
          <ContentSortControl
            ref={sortControlRef}
            value={sortOption}
            onChange={onSortChange}
            showRating={showRatingSort}
            nextFocusLeft={sortFocusLeftHandle}
          />
          <Text style={styles.subtitle}>{gridHeaderSuffix}</Text>
        </View>
      </View>

      {showInitialLoader ? (
        <View style={styles.loadingStage}>
          <View style={styles.largeLoader}>
            <NovaSpaceLoader label={loadingLabel} />
          </View>
        </View>
      ) : emptyNotice ? (
        <View style={styles.emptyNotice}>
          <MaterialCommunityIcons
            name={emptyNotice.includes('display') ? 'cloud-off-outline' : 'movie-off-outline'}
            size={22}
            color={theme.colors.textMuted}
          />
          <Text style={styles.emptyNoticeText}>{emptyNotice}</Text>
        </View>
      ) : (
        <View style={styles.listStage}>
          <FlatList
            ref={listRef}
            data={movies}
            key={columns}
            numColumns={columns}
            keyExtractor={keyExtractor}
            scrollEnabled
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.list}
            columnWrapperStyle={columns > 1 ? styles.row : undefined}
            removeClippedSubviews={TV_POSTER_LIST_TUNING.removeClippedSubviews}
            windowSize={TV_POSTER_LIST_TUNING.windowSize}
            maxToRenderPerBatch={TV_POSTER_LIST_TUNING.maxToRenderPerBatch}
            updateCellsBatchingPeriod={TV_POSTER_LIST_TUNING.updateCellsBatchingPeriod}
            initialNumToRender={columns * TV_POSTER_LIST_TUNING.initialRows}
            getItemLayout={getItemLayout}
            onEndReachedThreshold={TV_POSTER_LIST_TUNING.onEndReachedThreshold}
            onEndReached={requestMore}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            onViewableItemsChanged={handleViewableItemsChanged}
            renderItem={renderItem}
          />
          {showCategoryLoadingOverlay ? (
            <View style={styles.loadingOverlay} pointerEvents="none">
              <View style={styles.largeLoader}>
                <NovaSpaceLoader label={loadingLabel} />
              </View>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

function createStyles(theme: NovaTheme) {
  return StyleSheet.create({
    panel: {
      flex: 1,
      minWidth: 0,
      borderTopWidth: 1,
      borderTopColor: theme.colors.borderSubtle,
      backgroundColor: 'transparent',
      paddingHorizontal: 0,
      paddingTop: 8,
    },
    header: {
      minHeight: 36,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 6,
      paddingHorizontal: 2,
    },
    title: {
      flex: 1,
      minWidth: 0,
      color: theme.colors.textPrimary,
      fontSize: 20,
      fontWeight: '800',
    },
    subtitle: {
      color: theme.colors.textSecondary,
      fontSize: 12,
      fontWeight: '700',
    },
    sortGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    list: {
      paddingTop: 2,
      paddingBottom: 20,
      paddingHorizontal: 2,
    },
    row: {
      gap: 6,
      marginBottom: 6,
    },
    emptyNotice: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingHorizontal: 24,
      paddingBottom: 0,
    },
    emptyNoticeText: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      fontWeight: '600',
      textAlign: 'center',
    },
    loadingStage: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingBottom: 0,
    },
    listStage: {
      flex: 1,
      minHeight: 0,
    },
    loadingOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
    },
    largeLoader: {
      transform: [{ scale: 1.25 }],
    },
  });
}
