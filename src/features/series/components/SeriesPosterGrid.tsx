import type { ElementRef } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, View, useWindowDimensions, type ListRenderItemInfo } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';

import type { SeriesSummary } from '@/features/media-browser/mediaTypes';
import { useAppTheme, type NovaTheme } from '@/theme';
import { NovaSpaceLoader } from '@/components/nova/NovaSpaceLoader';
import { ContentSortControl, type ContentSortControlHandle } from '@/features/media-browser/ContentSortControl';
import type { ContentSortOption } from '@/features/media-browser/contentSorting';
import { shouldAutoFocusSortControl, shouldClaimPreferredPosterFocus, isLastPosterRow } from '@/features/media-browser/posterGridFocusPolicy';
import { estimatePosterRowHeight, TV_POSTER_LIST_TUNING } from '@/features/media-browser/tvPosterListTuning';
import { tvPerfRecordPosterRender, tvPerfSetVisiblePosters } from '@/features/perf/tvPerfStore';
import { requestTvFocus } from '@/features/navigation/tvFocusDiagnostics';

import { SeriesPosterCard } from './SeriesPosterCard';

type SeriesPosterGridProps = {
  series: SeriesSummary[];
  selectedCategoryLabel: string;
  selectedCategoryId: string;
  columns: number;
  hasMore: boolean;
  loading: boolean;
  categoryLoading?: boolean;
  focusedSeriesId: string | null;
  selectedSeriesId: string | null;
  postersFocusable?: boolean;
  /**
   * Stage 4.2O.1: force exactly one poster focusable even while
   * `postersFocusable` is false, so the Series Detail Popup V2 close path can
   * make the origin card focusable in the same synchronous render as the
   * close, instead of waiting on `postersFocusable` to flip (mirrors the
   * equivalent `closingFocusMovieId` fix on `MoviePosterGrid`).
   */
  closingFocusSeriesId?: string | null;
  onFocusSeries: (series: SeriesSummary) => void;
  onSelectSeries: (series: SeriesSummary) => void;
  registerPosterRef?: (seriesId: string, instance: ElementRef<typeof View> | null) => void;
  loadMore: () => void | Promise<void>;
  /**
   * series-pagination-focus-v6_1-confirmed-handoff
   * True only while an append is preserving native poster focus.
   */
  onPaginationFocusHandoffChange?: (active: boolean) => void;
  sortOption: ContentSortOption;
  onSortChange: (value: ContentSortOption) => void;
  showRatingSort?: boolean;
  isDiscover?: boolean;
  emptyNotice?: string | null;
  sortFocusLeftHandle?: number;
  onSortFocusHandleReady?: (handle: number | undefined) => void;
};

export function SeriesPosterGrid({
  series,
  selectedCategoryLabel,
  selectedCategoryId,
  columns,
  hasMore,
  loading,
  categoryLoading = false,
  focusedSeriesId,
  selectedSeriesId,
  postersFocusable = true,
  closingFocusSeriesId = null,
  onFocusSeries,
  onSelectSeries,
  registerPosterRef,
  loadMore,
  onPaginationFocusHandoffChange,
  sortOption,
  onSortChange,
  showRatingSort = true,
  isDiscover = false,
  emptyNotice = null,
  sortFocusLeftHandle,
  onSortFocusHandleReady,
}: SeriesPosterGridProps) {
  void isDiscover;
  const gridHeaderSuffix = loading ? 'Loading' : hasMore ? 'More available' : `${series.length} items`;
  const firstSeriesId = series[0]?.id;
  const focusSeedRef = useRef<string | null>(null);
  const focusClaimedRef = useRef(false);
  const firstCardRef = useRef<ElementRef<typeof View> | null>(null);
  const sortControlRef = useRef<ContentSortControlHandle | null>(null);
  const sortMountedRef = useRef(false);
  const loadMoreInFlightRef = useRef(false);
  const focusedSeriesIdRef = useRef<string | null>(focusedSeriesId);
  const [paginationFocusAnchorId, setPaginationFocusAnchorId] = useState<string | null>(null);
  const paginationRequestRef = useRef<{
    anchorId: string;
    anchorIndex: number;
    previousLength: number;
  } | null>(null);
  const paginationRestoreCancelRef = useRef<(() => void) | null>(null);
  const localPosterRefs = useRef<Map<string, ElementRef<typeof View>>>(new Map());
  const onFocusSeriesRef = useRef(onFocusSeries);
  const onSelectSeriesRef = useRef(onSelectSeries);
  const registerPosterRefRef = useRef(registerPosterRef);
  const onPaginationFocusHandoffChangeRef = useRef(onPaginationFocusHandoffChange);
  const seriesLengthRef = useRef(series.length);
  // series-pagination-focus-v6_2-stable-native-owner
  // Keep changing pagination inputs in refs so poster onFocus identity stays stable.
  const hasMoreRef = useRef(hasMore);
  const loadingRef = useRef(loading);
  const seriesRef = useRef(series);
  const columnsRef = useRef(columns);
  const loadMoreRef = useRef(loadMore);
  const requestMoreRef = useRef<(() => void) | null>(null);
  const paginationGuardWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { width } = useWindowDimensions();

  onFocusSeriesRef.current = onFocusSeries;
  onSelectSeriesRef.current = onSelectSeries;
  registerPosterRefRef.current = registerPosterRef;
  onPaginationFocusHandoffChangeRef.current = onPaginationFocusHandoffChange;
  seriesLengthRef.current = series.length;
  hasMoreRef.current = hasMore;
  loadingRef.current = loading;
  seriesRef.current = series;
  columnsRef.current = columns;
  loadMoreRef.current = loadMore;
  if (!focusedSeriesIdRef.current && focusedSeriesId) focusedSeriesIdRef.current = focusedSeriesId;

  const releasePaginationFocusGuard = useCallback((reason: string) => {
    const pending = paginationRequestRef.current;
    if (!pending) {
      return;
    }

    if (paginationGuardWatchdogRef.current) {
      clearTimeout(paginationGuardWatchdogRef.current);
      paginationGuardWatchdogRef.current = null;
    }

    paginationRequestRef.current = null;
    paginationRestoreCancelRef.current?.();
    paginationRestoreCancelRef.current = null;
    setPaginationFocusAnchorId(null);
    onPaginationFocusHandoffChangeRef.current?.(false);

    console.info('[NovaCast Series Pagination Focus]', {
      action: 'guard-released',
      itemId: pending.anchorId,
      reason,
    });
  }, []);

  const handleFocusSeries = useCallback(
    (nextSeries: SeriesSummary) => {
      focusClaimedRef.current = true;
      focusedSeriesIdRef.current = nextSeries.id;
      onFocusSeriesRef.current(nextSeries);

      // series-pagination-focus-v6_3-lookahead-native-stable
      // Begin the next SQLite page while the focused poster is still several
      // rows above the boundary. This keeps pagination off the critical
      // native-focus transition at the final row.
      const currentSeries = seriesRef.current;
      const focusedIndex = currentSeries.findIndex((item) => item.id === nextSeries.id);
      const currentColumns = Math.max(1, columnsRef.current);
      const prefetchRows = Math.max(4, TV_POSTER_LIST_TUNING.lookAheadRows);
      const prefetchItemCount = currentColumns * prefetchRows;
      const prefetchStartIndex = Math.max(0, currentSeries.length - prefetchItemCount);

      if (
        hasMoreRef.current &&
        !loadingRef.current &&
        focusedIndex >= prefetchStartIndex
      ) {
        requestMoreRef.current?.();
      }
    },
    [],
  );

  const handleSelectSeries = useCallback((nextSeries: SeriesSummary) => {
    onSelectSeriesRef.current(nextSeries);
  }, []);

  const handleRegisterRef = useCallback(
    (seriesId: string, instance: ElementRef<typeof View> | null) => {
      if (instance) {
        localPosterRefs.current.set(seriesId, instance);
      } else {
        localPosterRefs.current.delete(seriesId);
      }
      if (seriesId === firstSeriesId) {
        firstCardRef.current = instance;
      }
      registerPosterRefRef.current?.(seriesId, instance);
    },
    [firstSeriesId],
  );

  const requestMore = useCallback(() => {
    if (!hasMoreRef.current || loadingRef.current || loadMoreInFlightRef.current) {
      return;
    }

    const currentSeries = seriesRef.current;
    const focusedId = focusedSeriesIdRef.current;
    const focusedIndex = focusedId
      ? currentSeries.findIndex((item) => item.id === focusedId)
      : -1;
    const previousLength = currentSeries.length;

    loadMoreInFlightRef.current = true;

    console.info('[NovaCast Series Pagination Focus]', {
      action: 'prefetch-started',
      itemId: focusedId,
      itemIndex: focusedIndex,
      itemCount: previousLength,
      trigger: 'actual-lookahead-focus',
      strategy: 'native-focus-unchanged',
    });

    void Promise.resolve()
      .then(() => loadMoreRef.current())
      .finally(() => {
        loadMoreInFlightRef.current = false;
        console.info('[NovaCast Series Pagination Focus]', {
          action: 'prefetch-settled',
          itemId: focusedSeriesIdRef.current,
          previousLength,
          currentLength: seriesLengthRef.current,
          strategy: 'native-focus-unchanged',
        });
      });
  }, []);
  requestMoreRef.current = requestMore;

  useEffect(() => {
    if (!paginationFocusAnchorId) {
      return;
    }
    console.info('[NovaCast Series Pagination Focus]', {
      action: 'guard-committed',
      itemId: paginationFocusAnchorId,
      strategy: 'restore-same-anchor',
    });
  }, [paginationFocusAnchorId]);

  useEffect(() => {
    const pending = paginationRequestRef.current;
    if (!pending || series.length <= pending.previousLength) {
      return;
    }

    paginationRestoreCancelRef.current?.();
    paginationRestoreCancelRef.current = null;
    if (paginationGuardWatchdogRef.current) {
      clearTimeout(paginationGuardWatchdogRef.current);
      paginationGuardWatchdogRef.current = null;
    }

    console.info('[NovaCast Series Pagination Focus]', {
      action: 'append-committed',
      itemId: pending.anchorId,
      itemIndex: pending.anchorIndex,
      previousLength: pending.previousLength,
      nextLength: series.length,
    });

    // React has committed the appended array. Give native layout two frames,
    // then explicitly restore focus to the SAME poster that was focused before
    // pagination. This is the important difference from V4/V5: no
    // scrollToIndex and no predicted nextFocusDown target.
    let cancelled = false;
    let cancelFocusRequest: (() => void) | null = null;

    const frame1 = requestAnimationFrame(() => {
      const frame2 = requestAnimationFrame(() => {
        if (cancelled || paginationRequestRef.current !== pending) {
          return;
        }

        console.info('[NovaCast Series Pagination Focus]', {
          action: 'restore-requested',
          itemId: pending.anchorId,
          itemIndex: pending.anchorIndex,
        });

        cancelFocusRequest = requestTvFocus({
          screen: 'series',
          source: 'SeriesPosterGrid',
          region: 'poster-grid',
          itemId: pending.anchorId,
          reason: 'pagination-preserve-same-poster',
          maxFrames: 30,
          isActive: () => !cancelled && paginationRequestRef.current === pending,
          getTarget: () => localPosterRefs.current.get(pending.anchorId),
          onSettled: (status) => {
            if (cancelled || paginationRequestRef.current !== pending) {
              return;
            }

            console.info('[NovaCast Series Pagination Focus]', {
              action: 'restore-settled',
              itemId: pending.anchorId,
              status,
            });

            if (status !== 'executed') {
              releasePaginationFocusGuard(`restore-${status}`);
              return;
            }

            // requestTvFocus "executed" only means .focus() was issued.
            // Keep the grid anchor + surrounding chrome lock until the poster
            // actually reports onFocus. A short watchdog avoids a permanent lock
            // if Android does not emit onFocus because the anchor never lost it.
            if (paginationGuardWatchdogRef.current) {
              clearTimeout(paginationGuardWatchdogRef.current);
            }
            paginationGuardWatchdogRef.current = setTimeout(() => {
              if (paginationRequestRef.current === pending) {
                releasePaginationFocusGuard('focus-confirm-watchdog');
              }
            }, 500);
          },
        });
        paginationRestoreCancelRef.current = cancelFocusRequest;
      });

      if (cancelled) {
        cancelAnimationFrame(frame2);
      }
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame1);
      cancelFocusRequest?.();
      if (paginationRestoreCancelRef.current === cancelFocusRequest) {
        paginationRestoreCancelRef.current = null;
      }
    };
  }, [releasePaginationFocusGuard, series.length]);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  useEffect(() => {
    focusClaimedRef.current = false;
    focusSeedRef.current = selectedSeriesId ?? firstSeriesId ?? null;
  }, [firstSeriesId, selectedCategoryId, selectedSeriesId]);

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
    tvPerfSetVisiblePosters(Math.min(series.length, columns * TV_POSTER_LIST_TUNING.windowSize));
  }, [columns, series.length]);

  const columnWidth = useMemo(() => {
    const usable = Math.max(240, width - 320);
    return usable / Math.max(1, columns);
  }, [columns, width]);

  const rowHeight = useMemo(() => estimatePosterRowHeight(columnWidth), [columnWidth]);

  const getItemLayout = useCallback(
    (_data: ArrayLike<SeriesSummary> | null | undefined, index: number) => {
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
    ({ item, index }: ListRenderItemInfo<SeriesSummary>) => {
      tvPerfRecordPosterRender();
      return (
        <SeriesPosterCard
          series={item}
          focusable={postersFocusable || closingFocusSeriesId === item.id}
          trapFocusDown={isLastPosterRow({ index, itemCount: series.length, columns })}
          hasPreferredFocus={
            closingFocusSeriesId != null
              ? closingFocusSeriesId === item.id
              : shouldClaimPreferredPosterFocus({
                  focusClaimed: focusClaimedRef.current,
                  itemId: item.id,
                  seedId: focusSeedRef.current,
                })
          }
          onFocus={handleFocusSeries}
          onPress={handleSelectSeries}
          registerRef={(instance) => handleRegisterRef(item.id, instance)}
        />
      );
    },
    [
      closingFocusSeriesId,
      columns,
      handleFocusSeries,
      handleRegisterRef,
      handleSelectSeries,
      postersFocusable,
      paginationFocusAnchorId,
      series.length,
    ],
  );

  const keyExtractor = useCallback((item: SeriesSummary) => item.id, []);
  const loadingLabel = `Loading ${selectedCategoryLabel}...`;
  // media-category-hero-standard-v1
  // Category switches use the hero spaceship loader.
  // Pagination keeps the approved bottom-center glass pill.
  const showInitialLoader = categoryLoading && series.length === 0 && !emptyNotice;
  const showLoadingOverlay = categoryLoading && series.length > 0;
  // series-pagination-loader-movies-parity-v1
  // Visual-only parity with Movies: bottom-center glass pill while an
  // additional Series page is loading. This does not trigger pagination.
  const showPaginationLoader = loading && !categoryLoading && series.length > 0;

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
            focusable={closingFocusSeriesId == null && postersFocusable}
          />
          <Text style={styles.subtitle}>{gridHeaderSuffix}</Text>
        </View>
      </View>

      {showInitialLoader ? (
        <View style={styles.loadingStage}>
          <View style={styles.categoryLoaderContent}>
            <Text style={styles.categoryLoaderLabel} numberOfLines={2}>
              {loadingLabel}
            </Text>
            <NovaSpaceLoader label={loadingLabel} variant="hero" />
          </View>
        </View>
      ) : emptyNotice ? (
        <View style={styles.emptyNotice}>
          <MaterialCommunityIcons
            name={emptyNotice.includes('display') ? 'cloud-off-outline' : 'television-off'}
            size={22}
            color={theme.colors.textMuted}
          />
          <Text style={styles.emptyNoticeText}>{emptyNotice}</Text>
        </View>
      ) : (
        <View style={styles.listStage}>
          <FlatList
            data={series}
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
            renderItem={renderItem}
          />
          {showLoadingOverlay ? (
            <View
              style={styles.loadingOverlay}
              pointerEvents="none"
              accessible={false}
              focusable={false}>
              <View style={styles.categoryLoaderDim} />
              <View style={styles.categoryLoaderContent}>
                <Text style={styles.categoryLoaderLabel} numberOfLines={2}>
                  {loadingLabel}
                </Text>
                <NovaSpaceLoader label={loadingLabel} variant="hero" />
              </View>
            </View>
          ) : null}
          {showPaginationLoader ? (
            <View
              style={styles.paginationLoaderBar}
              pointerEvents="none"
              accessible={false}
              focusable={false}>
              <BlurView intensity={10} tint="dark" style={styles.paginationLoaderPill}>
                <NovaSpaceLoader label="Loading more series..." variant="inline" />
              </BlurView>
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
    sortGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    subtitle: {
      color: theme.colors.textSecondary,
      fontSize: 12,
      fontWeight: '700',
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
      minHeight: 0,
      position: 'relative',
    },
    listStage: {
      flex: 1,
      minHeight: 0,
    },
    loadingOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'flex-start',
      backgroundColor: 'transparent',
      borderWidth: 0,
      zIndex: 3,
    },
    categoryLoaderDim: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0, 0, 0, 0.28)',
    },
    categoryLoaderContent: {
      position: 'absolute',
      top: '42%',
      left: 12,
      right: 12,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 24,
      backgroundColor: 'transparent',
      borderWidth: 0,
      transform: [{ translateY: -52 }],
    },
    // media-category-hero-compact-v2
    categoryLoaderLabel: {
      color: theme.colors.textPrimary,
      fontSize: 18,
      lineHeight: 22,
      fontWeight: '700',
      letterSpacing: 0.1,
      textAlign: 'center',
      paddingHorizontal: 24,
      backgroundColor: 'transparent',
      zIndex: 1,
      textShadowColor: 'rgba(0, 0, 0, 0.65)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 5,
    },
    paginationLoaderBar: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
      borderWidth: 0,
      zIndex: 3,
    },
    paginationLoaderPill: {
      overflow: 'hidden',
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 44,
      paddingHorizontal: 18,
      paddingVertical: 9,
      borderRadius: 22,
      backgroundColor: 'rgba(4, 10, 24, 0.7)',
      borderWidth: 1,
      borderColor: 'rgba(95, 149, 216, 0.35)',
    },
  });
}
