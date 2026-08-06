import type { ElementRef } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, findNodeHandle, InteractionManager, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { getSeriesPosterColumns, NovaTvShell } from '@/components/nova';
import { NovaSpaceLoader } from '@/components/nova/NovaSpaceLoader';
import { SeriesDetailOverlay } from '@/features/series/components/SeriesDetailOverlay';
import {
  MEDIA_DETAIL_OVERLAY_STAGE4M_MARKER,
  canBeginDetailOverlayClose,
  logDetailOverlayEvent,
  shouldConsumeDetailOverlayBack,
  type DetailOverlayState,
  createClosedDetailOverlayState,
  openDetailOverlayState,
} from '@/features/media-detail';
import type { SeriesSummary } from '@/features/media-browser/mediaTypes';
import { isDiscoverCollectionsPending, useCatalogSyncStatus } from '@/features/hub/useCatalogSyncStatus';
import {
  finishUnifiedPlaybackClose,
  useUnifiedPlayer,
} from '@/features/playback/unified';
import { wrapOnnMoviesBackHandler } from '@/features/diagnostics/onnMoviesTrace';
import { createTvNavigationGate, tryAcquireTvNavigationGate } from '@/features/navigation/tvNavigation';
import { TV_HOME_ROUTE } from '@/features/navigation/tvRoutes';
import { ONBOARDING_GUIDES } from '@/features/onboarding/onboardingGuides';
import { WalkthroughOverlay } from '@/features/onboarding/WalkthroughOverlay';
import { useGuideWalkthrough } from '@/features/onboarding/useGuideWalkthrough';
import { useProviderStore } from '@/features/providers/providerStore';
import { useAppNotification } from '@/features/notifications/useAppNotification';
import { tvPerfSetFocus, tvPerfSetScreen } from '@/features/perf/tvPerfStore';
import { toggleMediaFavorite, toggleMediaWatchlist } from '@/features/media-browser/mediaLibraryStore';
import { MediaCategoryRail } from '@/features/media-browser/MediaCategoryRail';
import { buildSeriesMediaDetail, buildSeriesPreviewDetail } from '@/features/media-browser/mediaDetail';
import { displayProviderCategoryName } from '@/features/providers/categoryDisplay';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaTheme } from '@/theme/tokens';

import { SearchOverlay } from '@/features/search/SearchOverlay';
import { searchSeries } from '@/features/search/repositories/seriesSearchRepository';
import type { SearchResult } from '@/features/search/searchTypes';
import { requestTvFocus } from '@/features/navigation/tvFocusDiagnostics';
import {
  resolvePosterRestorationId,
  shouldPreferNavigationFocus,
} from '@/features/media-browser/posterGridFocusPolicy';
import { MovieToolbar } from '@/features/movies/components/MovieToolbar';
import { SeriesPosterGrid } from './components/SeriesPosterGrid';
import { launchSeriesEpisodePlayback } from './seriesPlayback';
import {
  SERIES_DETAIL_NOTIFICATION_ID,
  SERIES_LOAD_NOTIFICATION_ID,
  SERIES_NOTIFICATION_DURATION_MS,
  resolveSeriesDetailNotification,
  resolveSeriesNotificationForStatus,
} from './seriesScreenLogic';
import { getSeriesScreenMemory } from './seriesScreenMemory';
import { useSeriesScreenModel } from './useSeriesScreenModel';
import { setOnnSeriesGridMounted } from './seriesDiagnostics';
import { logSeriesBrowseIsolationViolation } from './seriesStartupRuntimeIsolation';

export function SeriesScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const styles = useMemo(() => createSeriesStyles(theme), [theme]);
  const { width } = useWindowDimensions();
  const navigationGateRef = useRef(createTvNavigationGate());
  const { selectedProvider, selectedProviderLabel } = useProviderStore();
  const activeProviderId = selectedProvider?.id ?? 'no-provider';
  const catalogSyncPhase = useCatalogSyncStatus(activeProviderId);
  const discoverStatusMessage = isDiscoverCollectionsPending(catalogSyncPhase)
    ? 'Preparing Features collections…'
    : null;
  const memory = getSeriesScreenMemory(activeProviderId);
  const guide = useGuideWalkthrough(ONBOARDING_GUIDES.series.key);
  const posterRefs = useRef<Map<string, ElementRef<typeof View>>>(new Map());
  const categoryRowRefs = useRef<Map<string, ElementRef<typeof Pressable>>>(new Map());
  const categoryFocusPendingRef = useRef<string | null>(null);
  const [categoryFocusLeftHandle, setCategoryFocusLeftHandle] = useState<number | undefined>();
  const [sortFocusRightHandle, setSortFocusRightHandle] = useState<number | undefined>();
  const [restoringBrowseFocus, setRestoringBrowseFocus] = useState(false);
  const [detailOverlayState, setDetailOverlayState] = useState<DetailOverlayState<SeriesSummary>>(
    createClosedDetailOverlayState,
  );
  const detailOpen = detailOverlayState.open;
  const detailCloseInFlightRef = useRef(false);
  const screenInstanceIdRef = useRef(`series-screen-${Date.now().toString(36)}`);
  const gridInstanceIdRef = useRef(`series-grid-${Date.now().toString(36)}`);
  const railInstanceIdRef = useRef(`series-rail-${Date.now().toString(36)}`);
  const browseSnapshotOnOpenRef = useRef<{
    screenInstanceId: string;
    gridInstanceId: string;
    railInstanceId: string;
    categoryId: string;
    visibleItemCount: number;
  } | null>(null);
  const detailOpenGuardRef = useRef({ categories: 0, visibleItems: 0, categoryId: '' });
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchOverlayReady, setSearchOverlayReady] = useState(false);
  const [focusedEpisodeId, setFocusedEpisodeId] = useState<string | null>(null);
  const { showNotification, dismissNotification, clearScope } = useAppNotification();
  const seriesRetryAttemptedRef = useRef(false);
  const seriesDetailRetryAttemptedRef = useRef(false);
  const lastRetryAtRef = useRef(0);
  const { isActive: playbackActive, isClosing: playbackClosing, didJustClose, launchPlayback, closePlayback } =
    useUnifiedPlayer();

  const {
    categories,
    selectedCategoryId,
    visibleItems,
    focusedItem,
    selectedItem,
    loading,
    categoryLoading,
    loadStatus,
    loadErrorMessage,
    hasMore,
    selectCategory,
    prefetchCategoryCount,
    focusSeries,
    selectSeries,
    loadMore,
    reload,
    seriesDetail,
    selectedSeasonId,
    selectSeason,
    detailLoading,
    detailError,
    loadSeriesDetail,
    continueWatching,
    isSelectedFavorite,
    isSelectedWatchlisted,
    hasDataSource,
    bundle,
    sortOption,
    setSort,
    categoryHasRatings,
  } = useSeriesScreenModel({
    initialSelectedCategoryId: memory.selectedCategoryId,
    initialFocusedSeriesId: memory.focusedSeriesId,
    initialSelectedSeriesId: memory.selectedSeriesId,
  });
  const playbackUiActive = playbackActive || playbackClosing;
  const detailOverlayVisible = detailOpen && !playbackUiActive && Boolean(selectedItem);
  const searchBlocksBrowse = searchOverlayReady;
  const selectedItemRef = useRef(selectedItem);

  useEffect(() => {
    if (!searchOpen || playbackUiActive) {
      setSearchOverlayReady(false);
    }
  }, [playbackUiActive, searchOpen]);

  useEffect(() => {
    selectedItemRef.current = selectedItem;
  }, [selectedItem]);

  const posterColumns = getSeriesPosterColumns(width);
  const selectedCategory = categories.find((category) => category.id === selectedCategoryId);
  const selectedCategoryLabel = selectedCategory
    ? displayProviderCategoryName({
        name: selectedCategory.name,
        rawName: selectedCategory.rawName,
        countryCode: selectedCategory.countryCode,
        contentType: 'series',
        kind: selectedCategory.kind,
      })
    : 'Series';

  const syncCategoryFocusLeftHandle = useCallback(() => {
    const target = categoryRowRefs.current.get(selectedCategoryId);
    setCategoryFocusLeftHandle(target ? findNodeHandle(target) ?? undefined : undefined);
  }, [selectedCategoryId]);

  useEffect(() => {
    syncCategoryFocusLeftHandle();
  }, [categories.length, selectedCategoryId, syncCategoryFocusLeftHandle]);

  const focusSelectedPoster = useCallback((reason = 'restore-selected-poster') => {
    const restoreId = resolvePosterRestorationId({
      focusedId: getSeriesScreenMemory(activeProviderId).focusedSeriesId,
      selectedId: selectedItem?.id ?? null,
      availableIds: visibleItems.map((item) => item.id),
    });
    if (!restoreId) {
      return;
    }

    setRestoringBrowseFocus(true);
    requestTvFocus({
      screen: 'series',
      source: 'SeriesScreen',
      region: 'poster-grid',
      itemId: restoreId,
      reason,
      getTarget: () => posterRefs.current.get(restoreId),
      onSettled: () => {
        setRestoringBrowseFocus(false);
      },
    });
  }, [activeProviderId, selectedItem?.id, visibleItems]);

  const closeDetailOverlay = useCallback(
    (source: 'back' | 'x') => {
      if (
        !canBeginDetailOverlayClose({
          open: detailOverlayState.open,
          closeInFlight: detailCloseInFlightRef.current,
        })
      ) {
        return;
      }
      detailCloseInFlightRef.current = true;
      const originItemId = detailOverlayState.originItemId;
      const before = browseSnapshotOnOpenRef.current;
      setDetailOverlayState(createClosedDetailOverlayState());
      logDetailOverlayEvent('series_detail_overlay_close', {
        source,
        originItemId,
        marker: MEDIA_DETAIL_OVERLAY_STAGE4M_MARKER,
      });
      if (
        before &&
        (before.screenInstanceId !== screenInstanceIdRef.current ||
          before.gridInstanceId !== gridInstanceIdRef.current ||
          before.railInstanceId !== railInstanceIdRef.current)
      ) {
        logDetailOverlayEvent('series_browse_instance_changed', {
          before,
          after: {
            screenInstanceId: screenInstanceIdRef.current,
            gridInstanceId: gridInstanceIdRef.current,
            railInstanceId: railInstanceIdRef.current,
          },
        });
      }
      if (originItemId) {
        requestTvFocus({
          screen: 'series',
          source: 'SeriesScreen',
          region: 'poster-grid',
          itemId: originItemId,
          reason: 'stage4m-restore-origin-poster',
          maxFrames: 2,
          isActive: () => !detailOverlayState.open,
          getTarget: () => posterRefs.current.get(originItemId) ?? null,
          onResult: (result) => {
            logDetailOverlayEvent('series_detail_origin_focus_result', {
              originItemId,
              requested: result.requested,
              reason: result.reason,
            });
          },
        });
      }
      detailCloseInFlightRef.current = false;
    },
    [detailOverlayState.open, detailOverlayState.originItemId],
  );

  const closeDetail = useCallback(() => {
    closeDetailOverlay('x');
  }, [closeDetailOverlay]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchOverlayReady(false);
    focusSelectedPoster('restore-after-search-close');
  }, [focusSelectedPoster]);

  useEffect(() => {
    tvPerfSetScreen('series');
  }, []);

  // Stage 4.2O: prove the poster grid instance owned by SeriesScreen never
  // remounts across category switching, Detail open/close, or playback.
  useEffect(() => {
    const instanceId = gridInstanceIdRef.current;
    setOnnSeriesGridMounted(true, instanceId);
    return () => {
      setOnnSeriesGridMounted(false, instanceId);
    };
  }, []);

  // Stage 4.2O §12: Detail/episode/playback isolation guard-rail diagnostics.
  // These only observe and log — they never redesign SeriesDetailOverlay itself.
  useEffect(() => {
    if (!detailOpen) {
      detailOpenGuardRef.current = {
        categories: categories.length,
        visibleItems: visibleItems.length,
        categoryId: selectedCategoryId,
      };
      return;
    }
    const guard = detailOpenGuardRef.current;
    if (guard.categories > 0 && categories.length === 0) {
      logSeriesBrowseIsolationViolation('categories-replaced-by-detail', {
        before: guard.categories,
        after: categories.length,
      });
    }
    if (guard.visibleItems > 0 && visibleItems.length === 0) {
      logSeriesBrowseIsolationViolation('visible-series-replaced-by-detail', {
        before: guard.visibleItems,
        after: visibleItems.length,
      });
    }
  }, [categories.length, detailOpen, selectedCategoryId, visibleItems.length]);

  const handleFocusSeries = useCallback(
    (series: Parameters<typeof focusSeries>[0]) => {
      tvPerfSetFocus('SeriesPosterCard', series.id);
      focusSeries(series);
    },
    [focusSeries],
  );

  const handleSelectSeries = useCallback(
    (series: Parameters<typeof selectSeries>[0]) => {
      if (detailOpen && selectedItem?.id === series.id) {
        return;
      }

      browseSnapshotOnOpenRef.current = {
        screenInstanceId: screenInstanceIdRef.current,
        gridInstanceId: gridInstanceIdRef.current,
        railInstanceId: railInstanceIdRef.current,
        categoryId: selectedCategoryId,
        visibleItemCount: visibleItems.length,
      };
      selectSeries(series);
      void loadSeriesDetail(series);
      setDetailOverlayState(openDetailOverlayState(series));
      logDetailOverlayEvent('series_detail_overlay_open', {
        seriesId: series.id,
        marker: MEDIA_DETAIL_OVERLAY_STAGE4M_MARKER,
      });
    },
    [detailOpen, loadSeriesDetail, selectSeries, selectedCategoryId, selectedItem?.id, visibleItems.length],
  );

  const handleRegisterPosterRef = useCallback((seriesId: string, instance: ElementRef<typeof View> | null) => {
    if (instance) {
      posterRefs.current.set(seriesId, instance);
    } else {
      posterRefs.current.delete(seriesId);
    }
  }, []);

  const handleSearchSelect = useCallback(
    (result: SearchResult) => {
      if (result.type !== 'series') {
        return;
      }

      setSearchOpen(false);
      setSearchOverlayReady(false);
      const series = {
        id: result.id,
        seriesId: result.seriesId ?? result.id,
        categoryId: result.categoryId ?? selectedCategoryId,
        title: result.title,
        year: result.year,
        rating: result.rating,
        genres: result.genres ?? ['Series'],
        posterUrl: result.posterUrl,
        posterStyleKey: 'ember' as const,
      };
      selectSeries(series);
      focusSeries(series);
      void loadSeriesDetail(series);
      setDetailOverlayState(openDetailOverlayState(series));
    },
    [focusSeries, loadSeriesDetail, selectSeries, selectedCategoryId],
  );

  const playEpisodeById = useCallback(
    async (episodeId: string, launchSource: 'play' | 'episode' = 'episode') => {
      if (!bundle || !seriesDetail) {
        return;
      }

      const episode = Object.values(seriesDetail.episodesBySeason)
        .flat()
        .find((item) => item.id === episodeId);
      if (!episode) {
        return;
      }

      // Keep overlay logically open but visually suppressed via playbackUiActive.
      await launchSeriesEpisodePlayback({
        bundle,
        providerId: activeProviderId,
        episode,
        seriesTitle: seriesDetail.title,
        artworkUrl: seriesDetail.posterUrl,
        launchSource,
        launchPlayback,
      });
    },
    [activeProviderId, bundle, launchPlayback, seriesDetail],
  );

  const playFirstEpisode = useCallback(
    async (fromBeginning = false) => {
      if (!seriesDetail) {
        return;
      }

      const allEpisodes = Object.values(seriesDetail.episodesBySeason).flat();
      const resumeEpisodeId = !fromBeginning ? continueWatching?.episodeId : undefined;
      const episode =
        (resumeEpisodeId ? allEpisodes.find((item) => item.id === resumeEpisodeId) : undefined) ?? allEpisodes[0];
      if (episode) {
        await playEpisodeById(episode.id, 'play');
      }
    },
    [continueWatching?.episodeId, playEpisodeById, seriesDetail],
  );

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      wrapOnnMoviesBackHandler(
        'series-screen',
        () => {
          if (guide.visible) {
            return true;
          }

          if (searchOpen) {
            closeSearch();
            return true;
          }

          if (
            shouldConsumeDetailOverlayBack({
              overlayOpen: detailOpen,
              overlayVisible: detailOverlayVisible,
            })
          ) {
            closeDetailOverlay('back');
            return true;
          }

          if (playbackClosing) {
            return true;
          }

          if (playbackActive) {
            closePlayback();
            return true;
          }

          if (!tryAcquireTvNavigationGate(navigationGateRef.current)) {
            return true;
          }

          router.replace(TV_HOME_ROUTE);
          return true;
        },
        () => ({
          screen: 'SeriesScreen',
          guideVisible: guide.visible,
          searchOpen,
          detailOpen,
          playbackActive,
          playbackClosing,
        }),
      ),
    );

    return () => subscription.remove();
  }, [
    closeDetailOverlay,
    closePlayback,
    closeSearch,
    detailOpen,
    detailOverlayVisible,
    guide.visible,
    playbackActive,
    playbackClosing,
    router,
    searchOpen,
  ]);

  useEffect(() => {
    if (!didJustClose) {
      return;
    }

    finishUnifiedPlaybackClose();

    // Stage 4.2M: returning from playback reveals the same Detail popup when still open.
    if (detailOverlayState.open) {
      logDetailOverlayEvent('series_detail_revealed_after_playback', {
        seriesId: detailOverlayState.originItemId,
        marker: MEDIA_DETAIL_OVERLAY_STAGE4M_MARKER,
      });
      return;
    }

    setRestoringBrowseFocus(true);
    const restoreId = resolvePosterRestorationId({
      focusedId: getSeriesScreenMemory(activeProviderId).focusedSeriesId,
      selectedId: selectedItem?.id ?? null,
      availableIds: visibleItems.map((item) => item.id),
    });
    let cancelled = false;

    const task = InteractionManager.runAfterInteractions(() => {
      if (cancelled || !restoreId) {
        setRestoringBrowseFocus(false);
        return;
      }

      requestTvFocus({
        screen: 'series',
        source: 'SeriesScreen',
        region: 'poster-grid',
        itemId: restoreId,
        reason: 'restore-after-playback',
        isActive: () => !cancelled,
        getTarget: () => posterRefs.current.get(restoreId),
        onSettled: () => {
          if (!cancelled) {
            setRestoringBrowseFocus(false);
          }
        },
      });
    });

    return () => {
      cancelled = true;
      task.cancel();
      setRestoringBrowseFocus(false);
    };
  }, [
    activeProviderId,
    detailOverlayState.open,
    detailOverlayState.originItemId,
    didJustClose,
    selectedItem?.id,
    visibleItems,
  ]);

  const executeSeriesSearch = useCallback(
    (request: Parameters<typeof searchSeries>[2]) => searchSeries(activeProviderId, bundle?.seriesDataSource, request),
    [activeProviderId, bundle?.seriesDataSource],
  );

  const handleReload = useCallback(() => {
    const now = Date.now();
    if (now - lastRetryAtRef.current < 400) {
      return;
    }

    lastRetryAtRef.current = now;
    seriesRetryAttemptedRef.current = true;
    void reload();
  }, [reload]);

  const handleDetailRetry = useCallback(() => {
    const item = selectedItemRef.current;
    if (!item) {
      return;
    }

    seriesDetailRetryAttemptedRef.current = true;
    void loadSeriesDetail(item);
  }, [loadSeriesDetail]);

  const handleSelectCategory = useCallback(
    (categoryId: string) => {
      seriesRetryAttemptedRef.current = false;
      categoryFocusPendingRef.current = categoryId;
      setRestoringBrowseFocus(true);
      selectCategory(categoryId);
    },
    [selectCategory],
  );


  useEffect(() => {
    const pendingCategoryId = categoryFocusPendingRef.current;
    if (!pendingCategoryId || pendingCategoryId !== selectedCategoryId) {
      return;
    }

    if (categoryLoading || loadStatus === 'loading') {
      return;
    }

    const targetId = visibleItems[0]?.id ?? null;
    if (!targetId) {
      categoryFocusPendingRef.current = null;
      setRestoringBrowseFocus(false);
      return;
    }

    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      if (cancelled || categoryFocusPendingRef.current !== selectedCategoryId) {
        return;
      }

      requestTvFocus({
        screen: 'series',
        source: 'SeriesScreen',
        region: 'poster-grid',
        itemId: targetId,
        reason: 'focus-first-series-after-category',
        isActive: () =>
          !cancelled &&
          categoryFocusPendingRef.current === selectedCategoryId,
        getTarget: () => posterRefs.current.get(targetId),
        onSettled: () => {
          if (cancelled) {
            return;
          }
          categoryFocusPendingRef.current = null;
          setRestoringBrowseFocus(false);
        },
      });
    });

    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [categoryLoading || loadStatus === 'loading', selectedCategoryId, visibleItems]);
useEffect(() => {
    if (loadStatus === 'ready') {
      seriesRetryAttemptedRef.current = false;
    }
  }, [loadStatus]);

  useEffect(() => {
    if (!detailError) {
      seriesDetailRetryAttemptedRef.current = false;
    }
  }, [detailError]);

  useEffect(() => {
    if (!hasDataSource || categories.length === 0) {
      dismissNotification(SERIES_LOAD_NOTIFICATION_ID);
      return;
    }

    const spec = resolveSeriesNotificationForStatus(loadStatus, seriesRetryAttemptedRef.current, loadErrorMessage);
    if (!spec) {
      dismissNotification(SERIES_LOAD_NOTIFICATION_ID);
      return;
    }

    showNotification({
      id: SERIES_LOAD_NOTIFICATION_ID,
      type: 'error',
      title: spec.title,
      message: spec.message,
      duration: SERIES_NOTIFICATION_DURATION_MS,
      persistent: spec.persistent,
      position: 'bottom-right',
      scope: 'series',
    });
  }, [categories.length, dismissNotification, hasDataSource, loadErrorMessage, loadStatus, showNotification]);

  useEffect(() => {
    if (!detailOpen || !detailError) {
      dismissNotification(SERIES_DETAIL_NOTIFICATION_ID);
      return;
    }

    const spec = resolveSeriesDetailNotification(seriesDetailRetryAttemptedRef.current, detailError);
    showNotification({
      id: SERIES_DETAIL_NOTIFICATION_ID,
      type: 'warning',
      title: spec.title,
      message: spec.message,
      duration: SERIES_NOTIFICATION_DURATION_MS,
      persistent: spec.persistent,
      position: 'bottom-right',
      scope: 'series',
    });
  }, [detailError, detailOpen, dismissNotification, showNotification]);

  useEffect(() => {
    return () => {
      clearScope('series');
    };
  }, [clearScope]);

  const gridEmptyNotice =
    !loading && visibleItems.length === 0 && loadStatus === 'error'
      ? 'No series to display right now.'
      : !loading && visibleItems.length === 0 && loadStatus === 'empty'
        ? 'No series in this category.'
        : null;

  if (!hasDataSource || !bundle) {
    return (
      <NovaTvShell activeId="series" preferActiveNavigationFocus={false} compactNavigationRail>
        <View style={styles.emptyState}>
          <MaterialCommunityIcons name="alert-circle-outline" size={34} color={theme.colors.warning} />
          <Text style={styles.emptyTitle}>Series unavailable</Text>
          <Text style={styles.emptyCopy}>Connect a provider to browse your series library.</Text>
        </View>
      </NovaTvShell>
    );
  }

  if (categories.length === 0 && loadStatus === 'error') {
    return (
      <NovaTvShell activeId="series" preferActiveNavigationFocus={false} compactNavigationRail>
        <View style={styles.emptyState}>
          <MaterialCommunityIcons name="alert-circle-outline" size={34} color={theme.colors.warning} />
          <Text style={styles.emptyTitle}>Series unavailable</Text>
          <Text style={styles.emptyCopy}>{loadErrorMessage ?? 'Unable to load series categories from your provider.'}</Text>
          <Pressable
            focusable
            hasTVPreferredFocus
            accessibilityRole="button"
            accessibilityLabel="Retry Series"
            onPress={handleReload}
            style={styles.retryButton}>
            <MaterialCommunityIcons name="refresh" size={18} color={theme.colors.textPrimary} />
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      </NovaTvShell>
    );
  }

  return (
    <View style={styles.root}>
      <View
        style={[styles.browseLayer, playbackUiActive && styles.browseLayerHidden]}
        pointerEvents={detailOpen || searchBlocksBrowse || playbackUiActive ? 'none' : 'auto'}
        importantForAccessibility={
          detailOpen || searchBlocksBrowse || playbackUiActive ? 'no-hide-descendants' : 'auto'
        }
        accessibilityElementsHidden={detailOpen || searchBlocksBrowse || playbackUiActive}>
        <NovaTvShell
          activeId="series"
          providerLabel={selectedProviderLabel}
          preferActiveNavigationFocus={shouldPreferNavigationFocus({
            playbackUiActive,
            detailOverlayVisible,
            searchBlocksBrowse,
            restoringBrowseFocus,
            gridEmpty: visibleItems.length === 0,
          })}
          compactNavigationRail>
          <View style={styles.screen}>
            <View style={styles.topBar}>
              <View style={styles.headingBlock}>
                <Text style={styles.heading}>Series</Text>
                <Text style={styles.copy}>Browse seasons and episodes from your provider.</Text>
              </View>
              <MovieToolbar
                onSearchPress={() => {
                  if (searchOpen) {
                    closeSearch();
                    return;
                  }

                  setSearchOpen(true);
                }}
              />
            </View>
            <View style={styles.contentRow}>
            <MediaCategoryRail
              categories={categories}
              selectedCategoryId={selectedCategoryId}
              preferredCategoryId={selectedCategoryId}
              contentType="series"
              discoverStatusMessage={discoverStatusMessage}
              onSelectCategory={handleSelectCategory}
              onPrefetchCategoryCount={prefetchCategoryCount}
              registerItemRef={(categoryId, instance) => {
                if (instance) {
                  categoryRowRefs.current.set(categoryId, instance);
                } else {
                  categoryRowRefs.current.delete(categoryId);
                }
                if (categoryId === selectedCategoryId) {
                  syncCategoryFocusLeftHandle();
                }
              }}
              nextFocusRightHandle={sortFocusRightHandle}
            />

            <View style={styles.middleColumn}>
            {categories.length === 0 && loadStatus !== 'error' ? (
              <View style={styles.initialLoadingPanel}>
                <NovaSpaceLoader label="Loading series categories…" />
              </View>
            ) : (
            <SeriesPosterGrid
              series={visibleItems}
              selectedCategoryLabel={selectedCategoryLabel}
              selectedCategoryId={selectedCategoryId}
              columns={posterColumns}
              hasMore={hasMore}
              loading={loading}
              categoryLoading={categoryLoading}
              emptyNotice={gridEmptyNotice}
              focusedSeriesId={null}
              selectedSeriesId={selectedItem?.id ?? null}
              postersFocusable={!detailOpen && !playbackUiActive && !searchBlocksBrowse}
              onFocusSeries={handleFocusSeries}
              onSelectSeries={handleSelectSeries}
              registerPosterRef={handleRegisterPosterRef}
              sortOption={sortOption}
              onSortChange={setSort}
              showRatingSort={categoryHasRatings}
              sortFocusLeftHandle={categoryFocusLeftHandle}
              onSortFocusHandleReady={setSortFocusRightHandle}
              loadMore={loadMore}
            />
            )}
            </View>

            </View>
          </View>
        </NovaTvShell>
        </View>

      <SeriesDetailOverlay
        visible={detailOverlayVisible}
        detail={
          seriesDetail && seriesDetail.seriesId === selectedItem?.seriesId
            ? buildSeriesMediaDetail(seriesDetail)
            : selectedItem
              ? buildSeriesPreviewDetail(selectedItem)
              : null
        }
        detailError={detailError}
        detailLoading={detailLoading}
        isFavorite={isSelectedFavorite}
        isWatchlisted={isSelectedWatchlisted}
        continueWatchingLabel={continueWatching ? 'Resume' : 'Play'}
        onClose={() => closeDetailOverlay('x')}
        onRetry={selectedItem ? handleDetailRetry : undefined}
        onPlay={seriesDetail && seriesDetail.seriesId === selectedItem?.seriesId && seriesDetail.seasons.length ? () => void playFirstEpisode() : undefined}
        onPlayFromBeginning={seriesDetail && seriesDetail.seriesId === selectedItem?.seriesId ? () => void playFirstEpisode(true) : undefined}
        onFavoritePress={
          seriesDetail && seriesDetail.seriesId === selectedItem?.seriesId
            ? () => {
                void toggleMediaFavorite(activeProviderId, seriesDetail.seriesId, 'series', {
                  title: seriesDetail.title,
                  artworkUrl: seriesDetail.posterUrl,
                });
              }
            : undefined
        }
        onWatchlistPress={
          seriesDetail && seriesDetail.seriesId === selectedItem?.seriesId
            ? () => {
                void toggleMediaWatchlist(activeProviderId, seriesDetail.seriesId);
              }
            : undefined
        }
        selectedSeasonNumber={Number(selectedSeasonId) || undefined}
        focusedEpisodeId={focusedEpisodeId}
        onSeasonPress={(seasonNumber) => selectSeason(String(seasonNumber))}
        onEpisodeFocus={setFocusedEpisodeId}
        onEpisodePress={(episode) => {
          setFocusedEpisodeId(episode.id);
          void playEpisodeById(episode.id, 'episode');
        }}
      />

      <SearchOverlay
        visible={searchOpen && !playbackUiActive}
        scope="series"
        providerId={activeProviderId}
        title="Search Series"
        executeSearch={executeSeriesSearch}
        onReady={() => setSearchOverlayReady(true)}
        onClose={closeSearch}
        onSelectResult={handleSearchSelect}
      />

      <WalkthroughOverlay
        key={guide.visible ? 'series-guide-open' : 'series-guide-closed'}
        visible={guide.visible && !playbackUiActive}
        title={ONBOARDING_GUIDES.series.title}
        steps={ONBOARDING_GUIDES.series.steps}
        onDismiss={guide.dismiss}
        onSkip={guide.skip}
        onDontShowAgain={guide.dontShowAgain}
        onComplete={guide.complete}
      />
    </View>
  );
}

function createSeriesStyles(theme: NovaTheme) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: 'transparent',
    },
    browseLayer: {
      flex: 1,
    },
    browseLayerHidden: {
      display: 'none',
      opacity: 0,
    },
    screen: {
      flex: 1,
      minHeight: 0,
      paddingTop: 4,
      gap: 12,
    },
    topBar: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
    },
    headingBlock: {
      flex: 1,
      minWidth: 0,
    },
    heading: {
      color: theme.colors.textPrimary,
      fontSize: 32,
      fontWeight: '900',
      letterSpacing: -0.5,
    },
    copy: {
      marginTop: 2,
      color: theme.colors.textSecondary,
      fontSize: 14,
    },
    contentRow: {
      flex: 1,
      minHeight: 0,
      flexDirection: 'row',
      gap: 10,
      alignItems: 'stretch',
    },
    middleColumn: {
      flex: 1,
      minWidth: 0,
    },
    initialLoadingPanel: {
      flex: 1,
      minHeight: 280,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingHorizontal: 24,
    },
    emptyTitle: {
      color: theme.colors.textPrimary,
      fontSize: 28,
      fontWeight: '900',
    },
    emptyCopy: {
      color: theme.colors.textSecondary,
      fontSize: 15,
      textAlign: 'center',
    },
    retryButton: {
      marginTop: 8,
      minHeight: 42,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: theme.colors.borderSubtle,
      backgroundColor: theme.colors.surface,
      paddingHorizontal: 16,
    },
    retryText: {
      color: theme.colors.textPrimary,
      fontSize: 13,
      fontWeight: '800',
    },
  });
}
