import type { ElementRef, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { FlatList, StyleSheet, Text, View, useWindowDimensions, type ListRenderItemInfo, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useAppTheme, type NovaTheme } from '@/theme';
import { shouldAutoFocusSortControl, shouldClaimPreferredPosterFocus, isLastPosterRow } from '@/features/media-browser/posterGridFocusPolicy';
import { ContentSortControl, type ContentSortControlHandle } from '@/features/media-browser/ContentSortControl';
import type { ContentSortOption } from '@/features/media-browser/contentSorting';
import { estimatePosterRowHeight, TV_POSTER_LIST_TUNING } from '@/features/media-browser/tvPosterListTuning';
import { tvPerfRecordPosterRender, tvPerfSetVisiblePosters } from '@/features/perf/tvPerfStore';

import type { MovieSummary } from '../movieTypes';
import {
  getMoviesDetailOpenForDiagnostics,
  getMoviesOnnTraceSnapshot,
  inferMovieGridUnmountReason,
} from '../moviesDiagnosticsState';
import { MoviePosterCard } from './MoviePosterCard';
import { recordFocusAudit } from '@/features/navigation/focusRequestAudit';
import {
  getOnnMoviesGridInstanceId,
  isOnnMoviesTraceEnabled,
  nextOnnMoviesGridInstanceId,
  noteOnnMoviesMount,
  noteOnnMoviesRender,
  noteOnnMoviesUnmount,
  setOnnMoviesGridMounted,
  traceOnnMoviesEvent,
  traceOnnMoviesScrollCommand,
  traceOnnMoviesScrollSample,
} from '@/features/diagnostics/onnMoviesTrace';

type MoviePosterGridProps = {
  movies: MovieSummary[];
  selectedCategoryLabel: string;
  selectedCategoryId: string;
  columns: number;
  hasMore: boolean;
  loading: boolean;
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
  /**
   * Stage 3D.2: while post-restore latch is active, only this poster may hold
   * hasTVPreferredFocus. Does not re-request focus.
   */
  postRestorePreferredMovieId?: string | null;
  /**
   * Stage 3D.3: pin focus chrome on this poster during correction / latch
   * without requiring a second native onFocus.
   */
  pinnedHighlightMovieId?: string | null;
  /**
   * Stage 3D.3: briefly disable FlatList scroll during focus transfer to
   * prevent native one-row auto-align drift.
   */
  lockScrollForFocusRestore?: boolean;
  /** When true, snapshot said target was visible — do not use index positioning. */
  snapshotTargetWasVisible?: boolean;
  onViewportChange?: (state: { offset: number; firstIndex: number | null; lastIndex: number | null }) => void;
  suppressPreferredFocus?: boolean;
  /**
   * Stage 3E.3: absolute overlays (primary/pagination loaders) rendered inside the
   * poster list viewport — not the screen shell and not FlatList footer content.
   */
  listOverlays?: ReactNode;
};

export function MoviePosterGrid({
  movies,
  selectedCategoryLabel,
  selectedCategoryId,
  columns,
  hasMore,
  loading,
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
  postRestorePreferredMovieId = null,
  pinnedHighlightMovieId = null,
  lockScrollForFocusRestore = false,
  snapshotTargetWasVisible = false,
  onViewportChange,
  suppressPreferredFocus = false,
  listOverlays = null,
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
  const gridInstanceIdRef = useRef<string | null>(null);
  const selectedCategoryIdRef = useRef(selectedCategoryId);
  selectedCategoryIdRef.current = selectedCategoryId;

  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  onFocusMovieRef.current = onFocusMovie;
  onSelectMovieRef.current = onSelectMovie;
  registerPosterRefRef.current = registerPosterRef;
  // Diagnostics-only mirrors so lifecycle logs can report current values
  // without widening the mount/unmount effect dependencies.
  moviesDiagnosticsRef.current = movies;
  restorationTokenDiagnosticsRef.current = restorationToken;

  if (isOnnMoviesTraceEnabled()) {
    noteOnnMoviesRender('MoviePosterGrid');
  }

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
    const instanceId = nextOnnMoviesGridInstanceId();
    gridInstanceIdRef.current = instanceId;
    setOnnMoviesGridMounted(true, instanceId);
    const snap = getMoviesOnnTraceSnapshot();
    noteOnnMoviesMount('MoviePosterGrid', {
      instanceId,
      columns,
      categoryId: selectedCategoryIdRef.current,
      movieCount: moviesDiagnosticsRef.current.length,
    });
    traceOnnMoviesEvent('Render', 'movie_grid_mount', {
      instanceId,
      columns,
      categoryId: selectedCategoryIdRef.current,
      movieCount: moviesDiagnosticsRef.current.length,
      generation: snap.readableGeneration,
      detailOpen: getMoviesDetailOpenForDiagnostics(),
      restorationActive: Boolean(restorationTokenDiagnosticsRef.current),
    });
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
      const lastCategoryId = selectedCategoryIdRef.current;
      const lastMovieCount = moviesDiagnosticsRef.current.length;
      const snap = getMoviesOnnTraceSnapshot();
      noteOnnMoviesUnmount('MoviePosterGrid', {
        instanceId,
        categoryId: lastCategoryId,
        movieCount: lastMovieCount,
      });
      traceOnnMoviesEvent('Render', 'movie_grid_unmount', {
        instanceId,
        lastCategoryId,
        lastMovieCount,
        categoriesLength: snap.categoriesLength,
        loadStatus: snap.loadStatus,
        detailOpen: getMoviesDetailOpenForDiagnostics(),
        restorationActive: Boolean(restorationTokenDiagnosticsRef.current),
        reason: inferMovieGridUnmountReason(),
      });
      setOnnMoviesGridMounted(false, instanceId);
      if (getOnnMoviesGridInstanceId() === instanceId) {
        gridInstanceIdRef.current = null;
      }
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
      const currentOffset = currentOffsetRef.current;
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
            currentOffset,
            focusedMovieId: selectedMovieId,
            restorationActive: true,
            timestamp: Date.now(),
          }),
      );
      traceOnnMoviesScrollCommand({
        requestedOffset: offset,
        currentOffset,
        animated: false,
        reason:
          viewportRestoreCommand.reason === 'corrective'
            ? 'corrective-native-focus-drift'
            : 'initial-detail-restore',
        restorationToken: viewportRestoreCommand.token,
        restoreAttempt: viewportRestoreCommand.reason === 'corrective' ? 2 : 1,
        detailPhase: getMoviesOnnTraceSnapshot().detailFocusPhase,
        categoryId: selectedCategoryIdRef.current,
      });
      if (isOnnMoviesTraceEnabled()) {
        traceOnnMoviesScrollSample(
          'scroll-before-request',
          { offset: currentOffset, requestedOffset: offset },
          true,
        );
      }
      listRef.current?.scrollToOffset({ offset, animated: false });
      if (isOnnMoviesTraceEnabled()) {
        traceOnnMoviesScrollSample(
          'scroll-first-after-request',
          { offset: currentOffsetRef.current, requestedOffset: offset },
          true,
        );
      }
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
      const currentOffset = currentOffsetRef.current;
      console.info(
        '[NovaCast Movies Scroll Command] ' +
          JSON.stringify({
            token: restorationToken,
            source: 'detail-restoration-offscreen-saved-offset',
            method: 'scrollToOffset',
            requestedIndex: restoreMovieIndex,
            requestedOffset: offset,
            currentOffset,
            focusedMovieId: selectedMovieId,
            restorationActive: true,
            timestamp: Date.now(),
          }),
      );
      traceOnnMoviesScrollCommand({
        requestedOffset: offset,
        currentOffset,
        animated: false,
        reason: 'initial-detail-restore',
        restorationToken,
        restoreAttempt: 1,
        detailPhase: getMoviesOnnTraceSnapshot().detailFocusPhase,
        categoryId: selectedCategoryIdRef.current,
      });
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
    if (isOnnMoviesTraceEnabled()) {
      traceOnnMoviesScrollSample('movies-grid', {
        offset,
        firstIndex: visibleRangeRef.current.firstIndex,
        lastIndex: visibleRangeRef.current.lastIndex,
        categoryId: selectedCategoryIdRef.current,
        gridInstanceId: gridInstanceIdRef.current,
        restorationActive: Boolean(restorationTokenDiagnosticsRef.current),
      });
    }
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
          forceFocused={
            pinnedHighlightMovieId != null
              ? pinnedHighlightMovieId === item.id
              : closingFocusMovieId === item.id || postRestorePreferredMovieId === item.id
          }
          auditSelected={selectedMovieId != null && selectedMovieId === item.id}
          hasPreferredFocus={
            // Stage 3D.2: restored poster retains preferred ownership after confirm.
            postRestorePreferredMovieId != null
              ? postRestorePreferredMovieId === item.id
              : // Stage 3D: never let first-poster preferred focus compete during close.
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
      pinnedHighlightMovieId,
      postRestorePreferredMovieId,
      postersFocusable,
      selectedMovieId,
      suppressPreferredFocus,
    ],
  );

  const keyExtractor = useCallback((item: MovieSummary) => item.id, []);

  // Stage 3E.1: visual loaders are owned by MoviesScreen (primary + pagination).

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

      {emptyNotice ? (
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
            scrollEnabled={!lockScrollForFocusRestore}
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
          {listOverlays}
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
    listStage: {
      flex: 1,
      minHeight: 0,
      position: 'relative',
      overflow: 'hidden',
    },
  });
}
