import type { ElementRef } from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { FlatList, StyleSheet, Text, View, useWindowDimensions, type ListRenderItemInfo } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useAppTheme, type NovaTheme } from '@/theme';
import { NovaSpaceLoader } from '@/components/nova/NovaSpaceLoader';
import { shouldAutoFocusSortControl, shouldClaimPreferredPosterFocus, isLastPosterRow } from '@/features/media-browser/posterGridFocusPolicy';
import { ContentSortControl, type ContentSortControlHandle } from '@/features/media-browser/ContentSortControl';
import type { ContentSortOption } from '@/features/media-browser/contentSorting';
import { estimatePosterRowHeight, TV_POSTER_LIST_TUNING } from '@/features/media-browser/tvPosterListTuning';
import { tvPerfRecordPosterRender, tvPerfSetVisiblePosters } from '@/features/perf/tvPerfStore';

import type { MovieSummary } from '../movieTypes';
import { MoviePosterCard } from './MoviePosterCard';

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
  registerPosterRef?: (movieId: string, instance: ElementRef<typeof View> | null) => void;
  loadMore: () => void;
  sortOption: ContentSortOption;
  onSortChange: (value: ContentSortOption) => void;
  showRatingSort?: boolean;
  isDiscover?: boolean;
  emptyNotice?: string | null;
  sortFocusLeftHandle?: number;
  onSortFocusHandleReady?: (handle: number | undefined) => void;
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
}: MoviePosterGridProps) {
  const gridHeaderSuffix = loading ? 'Loading' : hasMore ? 'More available' : `${movies.length} items`;
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
  const { width } = useWindowDimensions();

  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  onFocusMovieRef.current = onFocusMovie;
  onSelectMovieRef.current = onSelectMovie;
  registerPosterRefRef.current = registerPosterRef;

  const handleFocusMovie = useCallback((movie: MovieSummary) => {
    focusClaimedRef.current = true;
    onFocusMovieRef.current(movie);
  }, []);

  const handleSelectMovie = useCallback((movie: MovieSummary) => {
    onSelectMovieRef.current(movie);
  }, []);

  const handleRegisterRef = useCallback(
    (movieId: string, instance: ElementRef<typeof View> | null) => {
      if (movieId === firstMovieId) {
        firstCardRef.current = instance;
      }
      registerPosterRefRef.current?.(movieId, instance);
    },
    [firstMovieId],
  );

  const requestMore = useCallback(() => {
    if (!hasMore || loading || loadMoreInFlightRef.current) {
      return;
    }

    loadMoreInFlightRef.current = true;
    Promise.resolve()
      .then(loadMore)
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

    requestAnimationFrame(() => sortControlRef.current?.focus());
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
          focusable={postersFocusable}
          trapFocusDown={isLastPosterRow({ index, itemCount: movies.length, columns })}
          hasPreferredFocus={shouldClaimPreferredPosterFocus({
            focusClaimed: focusClaimedRef.current,
            itemId: item.id,
            seedId: focusSeedRef.current,
          })}
          onFocus={handleFocusMovie}
          onPress={handleSelectMovie}
          registerRef={(instance) => handleRegisterRef(item.id, instance)}
        />
      );
    },
    [columns, handleFocusMovie, handleRegisterRef, handleSelectMovie, isDiscover, movies.length, postersFocusable],
  );

  const keyExtractor = useCallback((item: MovieSummary) => item.id, []);

  const loadingLabel = `Loading ${selectedCategoryLabel}…`;
  const showInitialLoader = categoryLoading && movies.length === 0 && !emptyNotice;
  const showLoadingOverlay = categoryLoading && movies.length > 0;
  const showFooterLoader = loading && !categoryLoading && movies.length > 0;
  const listFooter = useMemo(
    () =>
      showFooterLoader ? (
        <View style={styles.footerLoader}>
          <NovaSpaceLoader label="Loading more…" variant="inline" />
        </View>
      ) : null,
    [showFooterLoader, styles.footerLoader],
  );

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
          <NovaSpaceLoader label={loadingLabel} />
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
            initialNumToRender={columns * 3}
            getItemLayout={getItemLayout}
            onEndReachedThreshold={TV_POSTER_LIST_TUNING.onEndReachedThreshold}
            onEndReached={requestMore}
            ListFooterComponent={listFooter}
            renderItem={renderItem}
          />
          {showLoadingOverlay ? (
            <View style={styles.loadingOverlay} pointerEvents="none">
              <NovaSpaceLoader label={loadingLabel} />
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
      paddingBottom: 24,
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
      paddingBottom: 24,
    },
    listStage: {
      flex: 1,
      minHeight: 0,
    },
    loadingOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor:
        theme.colors.background === '#F3EEE4' ? 'rgba(26,21,16,0.45)' : 'rgba(0,0,0,0.35)',
    },
    footerLoader: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 16,
    },
  });
}
