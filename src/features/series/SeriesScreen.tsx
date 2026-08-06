import type { ElementRef } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, findNodeHandle, InteractionManager, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { getSeriesPosterColumns, NovaTvShell } from '@/components/nova';
import { NovaSpaceLoader } from '@/components/nova/NovaSpaceLoader';
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
import { SeriesDetailPopupV2 } from './components/SeriesDetailPopupV2';
import { launchSeriesEpisodePlayback } from './seriesPlayback';
import {
  SERIES_DETAIL_NOTIFICATION_ID,
  SERIES_LOAD_NOTIFICATION_ID,
  SERIES_NOTIFICATION_DURATION_MS,
  SERIES_PLAYBACK_NOTIFICATION_ID,
  resolveSeriesDetailNotification,
  resolveSeriesNotificationForStatus,
  resolveSeriesPlaybackNotification,
} from './seriesScreenLogic';
import { getSeriesScreenMemory } from './seriesScreenMemory';
import { useSeriesScreenModel } from './useSeriesScreenModel';
import { setOnnSeriesGridMounted } from './seriesDiagnostics';
import { logSeriesBrowseIsolationViolation } from './seriesStartupRuntimeIsolation';
import {
  logSeriesDetailLegacyOverlayPathViolation,
  logSeriesDetailPopupV2Event,
} from './seriesDetailPopupV2';

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
  /**
   * Stage 4.2O.1 — SeriesDetailPopupV2's own simple state (spec section 2):
   * `{ open, series, originItemId }` only. No close phases, no transaction
   * watchdog, no Search focus bridge, no browse restoration pipeline. The
   * legacy `detailOverlayState` above is left in place (disconnected, guarded
   * by `logSeriesDetailLegacyOverlayPathViolation`) but nothing opens it
   * anymore — `detailOpen` therefore stays permanently false in normal use.
   */
  const [seriesDetailPopup, setSeriesDetailPopup] = useState<{
    open: boolean;
    series: SeriesSummary | null;
    originItemId: string | null;
  }>({ open: false, series: null, originItemId: null });
  const seriesDetailPopupOpenRef = useRef(false);
  const seriesDetailPopupCloseInFlightRef = useRef(false);
  /**
   * Stage 4.2O.1 fix (mirrors Movies' `v2CloseFocusTargetId`): force the
   * origin Series card focusable in the same synchronous close transition,
   * so it does not depend on `postersFocusable` settling before the deferred
   * `requestTvFocus`/`.focus()` call runs (the Search-steal fix Movies had to
   * discover the hard way — see `closeSeriesDetailPopup` below).
   */
  const [seriesV2CloseFocusTargetId, setSeriesV2CloseFocusTargetId] = useState<string | null>(null);
  /** True while native focus sits inside the popup's season/episode chip area. */
  const episodesAreaFocusedRef = useRef(false);
  const [episodesFocusReturnToken, setEpisodesFocusReturnToken] = useState(0);
  const [launchingEpisodePlayback, setLaunchingEpisodePlayback] = useState(false);
  const [episodePlaybackError, setEpisodePlaybackError] = useState<string | null>(null);
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
  const playbackUiActive = playbackActive || playbackClosing || launchingEpisodePlayback;
  const detailOverlayVisible = detailOpen && !playbackUiActive && Boolean(selectedItem);
  // Stage 4.2O.1: the browse-hiding/accessibility gates below must observe
  // the V2 popup's own `open` flag, not the permanently-false legacy
  // `detailOpen` — otherwise the browse layer stays interactive/visible to
  // accessibility tools underneath the V2 popup.
  const seriesDetailPopupVisible = seriesDetailPopup.open && !playbackUiActive;
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
      // Stage 4.2O.1: this legacy multi-phase-adjacent close path is never
      // called by the new SeriesDetailPopupV2 flow. If it is ever reached
      // while V2 owns Series Detail, that is a forbidden violation — log it
      // loudly and refuse to run (mirrors Movies' `beginDetailFocusClose` guard).
      if (seriesDetailPopupOpenRef.current) {
        logSeriesDetailLegacyOverlayPathViolation({ source, from: 'closeDetailOverlay' });
        return;
      }
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

  /**
   * Stage 4.2O.1 — SeriesDetailPopupV2's own close path (mirrors the
   * equivalent Movies popup's close callback exactly). Back and X call this
   * same function. One state transition; at most one safe origin focus
   * request after close, deferred by two `requestAnimationFrame`s. No
   * closing-* phases, no visual isolation, no hold cover, no transaction
   * watchdog, no Search bridge.
   */
  const closeSeriesDetailPopup = useCallback(
    (source: 'back' | 'x') => {
      if (!seriesDetailPopupOpenRef.current || seriesDetailPopupCloseInFlightRef.current) {
        return;
      }
      seriesDetailPopupCloseInFlightRef.current = true;

      const originItemId = seriesDetailPopup.originItemId ?? seriesDetailPopup.series?.id ?? null;

      logSeriesDetailPopupV2Event('series_detail_popup_v2_close', { source, originItemId });

      // Immediate guest dismiss — browse stays mounted underneath.
      seriesDetailPopupOpenRef.current = false;
      episodesAreaFocusedRef.current = false;
      setSeriesDetailPopup({ open: false, series: null, originItemId: null });
      setEpisodePlaybackError(null);

      // Stage 4.2O.1 fix (see `seriesV2CloseFocusTargetId` declaration): force
      // the origin card focusable in this SAME synchronous transition so it
      // does not depend on `postersFocusable` settling before the deferred
      // focus request below runs.
      if (originItemId) {
        setSeriesV2CloseFocusTargetId(originItemId);
      }

      if (originItemId) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            requestTvFocus({
              screen: 'series',
              source: 'SeriesScreen',
              region: 'poster-grid',
              itemId: originItemId,
              reason: 'stage4o1-restore-origin-poster',
              maxFrames: 3,
              isActive: () => !seriesDetailPopupOpenRef.current,
              getTarget: () => posterRefs.current.get(originItemId) ?? null,
              onResult: (result) => {
                logSeriesDetailPopupV2Event('series_detail_popup_v2_origin_focus_result', {
                  originItemId,
                  requested: result.requested,
                  reason: result.reason,
                });
                setSeriesV2CloseFocusTargetId((current) => (current === originItemId ? null : current));
              },
            });
          });
        });
      } else {
        logSeriesDetailPopupV2Event('series_detail_popup_v2_origin_focus_skipped', {
          reason: 'origin-missing',
        });
      }

      seriesDetailPopupCloseInFlightRef.current = false;
    },
    [seriesDetailPopup.originItemId, seriesDetailPopup.series?.id],
  );

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

  // Stage 4.2O §12 / Stage 4.2O.1: Detail/episode/playback isolation guard-rail
  // diagnostics. These only observe and log — retargeted to the V2 popup's own
  // `open` flag now that it (not the legacy overlay) owns Series Detail.
  useEffect(() => {
    if (!seriesDetailPopup.open) {
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
  }, [categories.length, seriesDetailPopup.open, selectedCategoryId, visibleItems.length]);

  const handleFocusSeries = useCallback(
    (series: Parameters<typeof focusSeries>[0]) => {
      tvPerfSetFocus('SeriesPosterCard', series.id);
      focusSeries(series);
    },
    [focusSeries],
  );

  const handleSelectSeries = useCallback(
    (series: Parameters<typeof selectSeries>[0]) => {
      if (seriesDetailPopup.open && seriesDetailPopup.series?.id === series.id) {
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
      // Stage 4.2O.1 — SeriesDetailPopupV2's own simple state (spec §2). The
      // legacy `SeriesDetailOverlay` is never opened on this path.
      episodesAreaFocusedRef.current = false;
      setEpisodePlaybackError(null);
      setSeriesV2CloseFocusTargetId(null);
      seriesDetailPopupOpenRef.current = true;
      setSeriesDetailPopup({ open: true, series, originItemId: series.id });
      logSeriesDetailPopupV2Event('series_detail_popup_v2_active', {
        seriesId: series.id,
        origin: 'browse',
      });
    },
    [loadSeriesDetail, selectSeries, selectedCategoryId, seriesDetailPopup.open, seriesDetailPopup.series?.id, visibleItems.length],
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
      episodesAreaFocusedRef.current = false;
      setEpisodePlaybackError(null);
      setSeriesV2CloseFocusTargetId(null);
      seriesDetailPopupOpenRef.current = true;
      setSeriesDetailPopup({ open: true, series, originItemId: series.id });
      logSeriesDetailPopupV2Event('series_detail_popup_v2_active', {
        seriesId: series.id,
        origin: 'search',
      });
    },
    [focusSeries, loadSeriesDetail, selectSeries, selectedCategoryId],
  );

  /**
   * Stage 4.2O.1 §6 — episode playback launch. Keeps SeriesDetailPopupV2's
   * state untouched (browse + popup both stay mounted); only
   * `launchingEpisodePlayback` visually suppresses the popup, mirroring the
   * legacy overlay's `playbackUiActive` suppression. On failure the popup
   * simply reappears (its own `visible` prop flips back true) with an inline
   * `playbackError` line — never a whole-screen error, never a route change.
   */
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

      setEpisodePlaybackError(null);
      setLaunchingEpisodePlayback(true);
      // Stage 4.2O.1 fix: the popup unmounts (`visible` -> false) while
      // playback is active, and Android does not reliably fire onBlur on the
      // episode/season chip when its host view unmounts mid-focus (same class
      // of bug as the popup's own `wasVisibleRef` reset). Without this, a
      // stale `true` here would make the NEXT Back press (after returning
      // from playback, with focus now on Resume) incorrectly collapse back
      // to the Episodes action instead of closing the popup.
      episodesAreaFocusedRef.current = false;
      try {
        const launched = await launchSeriesEpisodePlayback({
          bundle,
          providerId: activeProviderId,
          episode,
          seriesTitle: seriesDetail.title,
          artworkUrl: seriesDetail.posterUrl,
          launchSource,
          launchPlayback,
        });
        if (!launched) {
          setEpisodePlaybackError('This episode could not be played right now.');
        }
      } catch (err) {
        logSeriesDetailPopupV2Event('series_detail_popup_v2_playback_failed', {
          episodeId,
          message: err instanceof Error ? err.message : String(err),
        });
        setEpisodePlaybackError('This episode could not be played right now.');
      } finally {
        setLaunchingEpisodePlayback(false);
      }
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
          // Stage 4.2O.1: SeriesDetailPopupV2 owns Back while it is open. This
          // guard sits at the very top of the legacy handler (not dependent on
          // BackHandler listener registration order, which Movies found to be
          // unreliable on Android) so the V2 popup always wins. Episode-chip
          // focus collapses back to the Episodes action first (episode -> popup
          // -> browse); only a second Back closes the popup itself.
          if (seriesDetailPopupOpenRef.current) {
            if (episodesAreaFocusedRef.current) {
              episodesAreaFocusedRef.current = false;
              setEpisodesFocusReturnToken((token) => token + 1);
              return true;
            }
            closeSeriesDetailPopup('back');
            return true;
          }

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
    closeSeriesDetailPopup,
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

    // Stage 4.2O.1 §6: returning from playback reveals the same
    // SeriesDetailPopupV2 when still open — its own `visible` prop flips
    // false->true (playbackUiActive clears) which re-triggers the popup's
    // internal `wasVisibleRef` open effect, landing focus back on Play/Resume.
    // Browse's own poster-focus restoration below is skipped in that case.
    if (seriesDetailPopup.open) {
      logSeriesDetailPopupV2Event('series_detail_popup_v2_revealed_after_playback', {
        seriesId: seriesDetailPopup.originItemId,
      });
      return;
    }

    // Legacy overlay path — dead in normal operation since V2 owns opening,
    // kept only so the disconnected `SeriesDetailOverlay` machinery below
    // does not silently diverge from this effect's shape.
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
    seriesDetailPopup.open,
    seriesDetailPopup.originItemId,
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
    // Stage 4.2O.1: retargeted to the V2 popup's own `open` flag (spec §4 —
    // enrichment failures show an inline message in the popup AND this
    // existing toast, same as before; the popup itself never closes for this).
    if (!seriesDetailPopup.open || !detailError) {
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
  }, [detailError, seriesDetailPopup.open, dismissNotification, showNotification]);

  useEffect(() => {
    if (!episodePlaybackError) {
      dismissNotification(SERIES_PLAYBACK_NOTIFICATION_ID);
      return;
    }

    const spec = resolveSeriesPlaybackNotification(episodePlaybackError);
    showNotification({
      id: SERIES_PLAYBACK_NOTIFICATION_ID,
      type: 'error',
      title: spec.title,
      message: spec.message,
      duration: SERIES_NOTIFICATION_DURATION_MS,
      persistent: spec.persistent,
      position: 'bottom-right',
      scope: 'series',
    });
  }, [dismissNotification, episodePlaybackError, showNotification]);

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
        pointerEvents={seriesDetailPopup.open || searchBlocksBrowse || playbackUiActive ? 'none' : 'auto'}
        importantForAccessibility={
          seriesDetailPopup.open || searchBlocksBrowse || playbackUiActive ? 'no-hide-descendants' : 'auto'
        }
        accessibilityElementsHidden={seriesDetailPopup.open || searchBlocksBrowse || playbackUiActive}>
        <NovaTvShell
          activeId="series"
          providerLabel={selectedProviderLabel}
          preferActiveNavigationFocus={shouldPreferNavigationFocus({
            playbackUiActive,
            detailOverlayVisible: seriesDetailPopupVisible,
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
              postersFocusable={!seriesDetailPopup.open && !playbackUiActive && !searchBlocksBrowse}
              closingFocusSeriesId={seriesV2CloseFocusTargetId}
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

      {/*
        Stage 4.2O.1 — SeriesDetailPopupV2 is the only active Series Detail
        popup. The legacy `SeriesDetailOverlay` component is no longer
        imported or rendered (spec §9); its supporting state/effects above
        (`detailOverlayState`, `closeDetailOverlay`, `detailOverlayVisible`)
        are left in source, disconnected, guarded by
        `logSeriesDetailLegacyOverlayPathViolation` — nothing opens them
        anymore, so `detailOverlayVisible` is permanently false.
      */}
      <SeriesDetailPopupV2
        visible={seriesDetailPopup.open && !playbackUiActive}
        series={seriesDetailPopup.series}
        detail={
          seriesDetailPopup.series
            ? seriesDetail && seriesDetail.seriesId === seriesDetailPopup.series.seriesId
              ? buildSeriesMediaDetail(seriesDetail)
              : buildSeriesPreviewDetail(seriesDetailPopup.series)
            : null
        }
        loading={detailLoading}
        error={detailError}
        playbackError={episodePlaybackError}
        playLabel={continueWatching ? 'Resume' : 'Play'}
        isFavorite={isSelectedFavorite}
        isWatchlisted={isSelectedWatchlisted}
        originItemId={seriesDetailPopup.originItemId}
        onClose={(source) => closeSeriesDetailPopup(source)}
        onRetry={seriesDetailPopup.series ? handleDetailRetry : undefined}
        onPlay={
          seriesDetail && seriesDetail.seriesId === seriesDetailPopup.series?.seriesId && seriesDetail.seasons.length
            ? () => void playFirstEpisode()
            : undefined
        }
        onToggleFavorite={
          seriesDetail && seriesDetail.seriesId === seriesDetailPopup.series?.seriesId
            ? () => {
                void toggleMediaFavorite(activeProviderId, seriesDetail.seriesId, 'series', {
                  title: seriesDetail.title,
                  artworkUrl: seriesDetail.posterUrl,
                });
              }
            : undefined
        }
        onToggleWatchlist={
          seriesDetail && seriesDetail.seriesId === seriesDetailPopup.series?.seriesId
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
        onEpisodesAreaFocusChange={(focused) => {
          episodesAreaFocusedRef.current = focused;
        }}
        episodesFocusReturnToken={episodesFocusReturnToken}
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
