import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { ElementRef } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, findNodeHandle, InteractionManager, Linking, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { MediaDetailOverlay } from '@/components/media/MediaDetailOverlay';
import { getSeriesPosterColumns, NovaTvShell } from '@/components/nova';
import { NovaSpaceLoader } from '@/components/nova/NovaSpaceLoader';
import { isDiscoverCollectionsPending, useCatalogSyncStatus } from '@/features/hub/useCatalogSyncStatus';
import { useAppNotification } from '@/features/notifications/useAppNotification';
import { WalkthroughOverlay } from '@/features/onboarding/WalkthroughOverlay';
import { ONBOARDING_GUIDES } from '@/features/onboarding/onboardingGuides';
import { useGuideWalkthrough } from '@/features/onboarding/useGuideWalkthrough';
import { tvPerfSetFocus, tvPerfSetScreen } from '@/features/perf/tvPerfStore';
import {
  finishUnifiedPlaybackClose,
  useUnifiedPlayer,
} from '@/features/playback/unified';
import {
  isUnifiedRemoteDebugEnabled,
  logUnifiedRemoteEvent,
} from '@/features/playback/unified/unifiedRemoteDebug';
import { useProviderStore } from '@/features/providers/providerStore';
import { useActiveProviderBundle } from '@/features/providers/useActiveProviderBundle';

import { isFeaturesSmartCategoryId } from '@/features/media-browser/mediaCategoryUtils';
import { createTvNavigationGate, tryAcquireTvNavigationGate } from '@/features/navigation/tvNavigation';
import { TV_HOME_ROUTE } from '@/features/navigation/tvRoutes';
import { displayProviderCategoryName } from '@/features/providers/categoryDisplay';
import { buildMoviePlaybackUrlResolved } from '@/features/providers/providerPlayback';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaTheme } from '@/theme/tokens';
import { MovieCategoryRail } from './components/MovieCategoryRail';
import { MoviePosterGrid } from './components/MoviePosterGrid';
import { MovieToolbar } from './components/MovieToolbar';
import { getMoviesScreenMemory, rememberMoviesScreenMemory } from './moviesScreenMemory';
import { useMoviesScreenModel } from './useMoviesScreenModel';

import { buildMoviePreviewDetail } from '@/features/media-browser/mediaDetail';
import {
  deriveMoviesFocusOwner,
  resolvePosterRestorationId,
} from '@/features/media-browser/posterGridFocusPolicy';
import { requestTvFocus } from '@/features/navigation/tvFocusDiagnostics';
import { beginFocusAuditCycle, recordFocusAudit } from '@/features/navigation/focusRequestAudit';
import { PLAYBACK_NOTIFICATION_DURATION_MS, PLAYBACK_NOTIFICATION_ID } from '@/features/playback/unified/unifiedPlayerLogic';
import { SearchOverlay } from '@/features/search/SearchOverlay';
import { searchMovies } from '@/features/search/repositories/movieSearchRepository';
import type { SearchResult } from '@/features/search/searchTypes';
import { logMoviesPlayback } from './moviesPlaybackDiagnostics';
import { decideMoviesBackAction, shouldHandleMoviesDetailBack } from './moviesPlaybackLogic';
import {
  MOVIES_DETAIL_NOTIFICATION_ID,
  MOVIES_LOAD_NOTIFICATION_ID,
  MOVIES_NOTIFICATION_DURATION_MS,
  resolveMoviesDetailNotification,
  resolveMoviesNotificationForStatus,
} from './moviesScreenLogic';
import { toggleFavorite, toggleWatchlist, useMovieLibraryStore } from './smart/movieLibraryStore';

const MOVIES_FOCUS_STAGE3B2_MARKER = 'stage3b2-movies-focus-loader-polish-v1';

console.info('[NovaCast Movies Diagnostics Build]', {
  version: 'stage3b2-data-audit',
});

export function MoviesScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const styles = useMemo(() => createMoviesStyles(theme), [theme]);
  const { width, height } = useWindowDimensions();
  const navigationGateRef = useRef(createTvNavigationGate());
  const { selectedProvider, selectedProviderLabel } = useProviderStore();
  const { bundle } = useActiveProviderBundle();
  const activeProviderId = selectedProvider?.id ?? 'no-provider';
  const catalogSyncPhase = useCatalogSyncStatus(activeProviderId);
  const discoverStatusMessage = isDiscoverCollectionsPending(catalogSyncPhase)
    ? 'Preparing Features collections…'
    : null;
  const moviesMemory = getMoviesScreenMemory(activeProviderId);
  const library = useMovieLibraryStore(activeProviderId);
  const guide = useGuideWalkthrough(ONBOARDING_GUIDES.movies.key);
  const posterRefs = useRef<
    Map<string, { instance: ElementRef<typeof View>; contentId: string; instanceToken: string; renderedIndex: number }>
  >(new Map());
  const categoryRowRefs = useRef<Map<string, ElementRef<typeof Pressable>>>(new Map());
  const categoryFocusPendingRef = useRef<string | null>(null);
  const browseFocusSnapshotRef = useRef<{ categoryId: string; movieId: string; index: number } | null>(null);
  const restorationTokenRef = useRef<{
    token: string;
    source: 'detail-close' | 'playback-close';
    categoryId: string;
    targetMovieId: string;
    targetIndex: number;
  } | null>(null);
  const restorationIssuedTokenRef = useRef<string | null>(null);
  const restorationSequenceRef = useRef(0);
  const [categoryFocusLeftHandle, setCategoryFocusLeftHandle] = useState<number | undefined>();
  const [sortFocusRightHandle, setSortFocusRightHandle] = useState<number | undefined>();
  const isRestoringPlaybackFocusRef = useRef(false);
  const [restoringBrowseFocus, setRestoringBrowseFocus] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const detailOpenRef = useRef(false);
  const previousMoviesDataRef = useRef<unknown>(null);
  const [restorationRetry, setRestorationRetry] = useState(0);
  const [detailSuppressedForPlayback, setDetailSuppressedForPlayback] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchOverlayReady, setSearchOverlayReady] = useState(false);
  const { showNotification, dismissNotification, clearScope } = useAppNotification();
  const moviesRetryAttemptedRef = useRef(false);
  const moviesDetailRetryAttemptedRef = useRef(false);
  const lastRetryAtRef = useRef(0);
  const lastPlaybackLaunchAtRef = useRef(0);
  const playbackLaunchInFlightRef = useRef(false);
  /** Captures the in-flight loadMovieDetail promise so startPlayback can await it. */
  const pendingDetailPromiseRef = useRef<Promise<void> | null>(null);
  const [launchingPlayback, setLaunchingPlayback] = useState(false);
  const playFocusGuardUntilRef = useRef(0);
  const { isActive: playbackActive, isClosing: playbackClosing, didJustClose, launchPlayback, closePlayback } =
    useUnifiedPlayer();
  const {
    categories,
    selectedCategoryId,
    selectedMovie,
    visibleMovies,
    loading,
    categoryLoading,
    loadStatus,
    loadErrorMessage,
    hasMore,
    selectCategory,
    prefetchCategoryCount,
    focusMovie,
    selectMovie,
    loadMovieDetail,
    movieDetail,
    detailLoading,
    detailError,
    loadMore,
    reload,
    hasDataSource,
    sortOption,
    setSort,
    categoryHasRatings,
    getFocusedMovieId,
  } = useMoviesScreenModel(undefined, {
    initialSelectedCategoryId: moviesMemory.selectedCategoryId,
    initialFocusedMovieId: moviesMemory.focusedMovieId,
    initialSelectedMovieId: moviesMemory.selectedMovieId,
  });
  const playbackUiActive = playbackActive || playbackClosing || launchingPlayback;
  const detailOverlayVisible =
    detailOpen && !detailSuppressedForPlayback && !playbackUiActive && Boolean(selectedMovie);
  const moviesFocusOwner = deriveMoviesFocusOwner({
    detailOpen: detailOverlayVisible,
    searchOpen: searchOverlayReady,
    restoringBrowseFocus,
    categoryLoading: categoryLoading || loadStatus === 'loading',
    loadStatus,
    hasPosters: visibleMovies.length > 0,
    hasCategories: categories.length > 0,
  });

  useEffect(() => {
    detailOpenRef.current = detailOpen;
  }, [detailOpen]);

  useEffect(() => {
    tvPerfSetScreen('movies');
  }, []);

  useEffect(() => {
    console.info('[NovaCast Movies Detail/List Audit]', {
      detailOpen,
      categoryId: selectedCategoryId,
      rowCount: visibleMovies.length,
      firstMovieId: visibleMovies[0]?.id ?? null,
      dataArrayChanged: previousMoviesDataRef.current !== visibleMovies,
    });
    previousMoviesDataRef.current = visibleMovies;
  }, [detailOpen, selectedCategoryId, visibleMovies]);

  useEffect(() => {
    if (detailOpen && !detailOverlayVisible) {
      console.info('[NovaCast Movies Detail Overlay Audit]', {
        phase: 'error-state',
        selectedMovieId: selectedMovie?.id ?? null,
        movieDetailId: movieDetail?.id ?? null,
        detailLoading,
        detailError,
        detailOverlayVisible,
      });
    }
  }, [detailError, detailLoading, detailOpen, detailOverlayVisible, movieDetail?.id, selectedMovie?.id]);

  const handleFocusMovie = useCallback(
    (movie: { id: string }) => {
      if (playbackUiActive || Date.now() < playFocusGuardUntilRef.current) {
        return;
      }
      tvPerfSetFocus('MoviePosterCard', movie.id);
      const restore = restorationTokenRef.current;
      if (restore) {
        const confirmed = restore.targetMovieId === movie.id;
        console.info('[NovaCast Movies Restore Confirm]', {
          token: restore.token,
          requestedMovieId: restore.targetMovieId,
          actuallyFocusedMovieId: movie.id,
          confirmed,
          retryCount: restorationRetry,
        });
        if (confirmed) {
          restorationTokenRef.current = null;
          restorationIssuedTokenRef.current = null;
          isRestoringPlaybackFocusRef.current = false;
          setRestoringBrowseFocus(false);
        } else {
          restorationIssuedTokenRef.current = null;
          setRestorationRetry((value) => value + 1);
        }
      }
      browseFocusSnapshotRef.current = {
        categoryId: selectedCategoryId,
        movieId: movie.id,
        index: Math.max(0, visibleMovies.findIndex((item) => item.id === movie.id)),
      };
      focusMovie(movie as Parameters<typeof focusMovie>[0]);
    },
    [focusMovie, playbackUiActive, selectedCategoryId, visibleMovies],
  );

  const handleSelectMovie = useCallback(
    (movie: Parameters<typeof selectMovie>[0]) => {
      if (
        playbackLaunchInFlightRef.current ||
        launchingPlayback ||
        playbackUiActive ||
        Date.now() < playFocusGuardUntilRef.current
      ) {
        logMoviesPlayback('select-blocked', {
          movieId: movie.id,
          reason: 'playback-guard',
        });
        return;
      }

      if (detailOpen && selectedMovie?.id === movie.id) {
        return;
      }

      browseFocusSnapshotRef.current = {
        categoryId: selectedCategoryId,
        movieId: movie.id,
        index: Math.max(0, visibleMovies.findIndex((item) => item.id === movie.id)),
      };
      selectMovie(movie);
      detailOpenRef.current = true;
      const detailPromise = loadMovieDetail(movie);
      pendingDetailPromiseRef.current = detailPromise;
      detailPromise.finally(() => {
        if (pendingDetailPromiseRef.current === detailPromise) {
          pendingDetailPromiseRef.current = null;
        }
      });
      setDetailSuppressedForPlayback(false);
      setDetailOpen(true);
    },
    [detailOpen, launchingPlayback, loadMovieDetail, playbackUiActive, selectMovie, selectedCategoryId, selectedMovie?.id, visibleMovies],
  );

  const handleRegisterPosterRef = useCallback((movieId: string, instance: ElementRef<typeof View> | null, instanceToken: string, renderedIndex: number) => {
    if (instance) {
      posterRefs.current.set(movieId, { instance, contentId: movieId, instanceToken, renderedIndex });
      console.info('[NovaCast Movie Poster Ref]', {
        action: 'register',
        contentId: movieId,
        instanceToken,
        nativeTag: findNodeHandle(instance) ?? null,
        renderedIndex,
      });
      return;
    }

    const stored = posterRefs.current.get(movieId);
    if (stored?.instanceToken === instanceToken) {
      posterRefs.current.delete(movieId);
      console.info('[NovaCast Movie Poster Ref]', {
        action: 'unregister',
        contentId: movieId,
        instanceToken,
        nativeTag: stored.instance ? findNodeHandle(stored.instance) ?? null : null,
        renderedIndex,
      });
    }
  }, []);

  const getValidatedPosterTarget = useCallback(
    (contentId: string, targetIndex?: number) => {
      const stored = posterRefs.current.get(contentId);
      const currentItem = targetIndex == null ? visibleMovies.find((movie) => movie.id === contentId) : visibleMovies[targetIndex];
      const valid =
        Boolean(stored) &&
        stored?.contentId === contentId &&
        currentItem?.id === contentId &&
        (targetIndex == null || stored?.renderedIndex === targetIndex);
      console.info('[NovaCast Movie Poster Ref]', {
        action: 'request',
        contentId,
        instanceToken: stored?.instanceToken ?? null,
        nativeTag: stored?.instance ? findNodeHandle(stored.instance) ?? null : null,
        renderedIndex: stored?.renderedIndex ?? targetIndex ?? null,
      });
      return valid ? stored!.instance : null;
    },
    [visibleMovies],
  );

  const handleLoadMore = useCallback(() => loadMore(), [loadMore]);

  useEffect(() => {
    if (!searchOpen || playbackUiActive) {
      setSearchOverlayReady(false);
    }
  }, [playbackUiActive, searchOpen]);

  useEffect(() => {
    if (playbackActive) {
      playFocusGuardUntilRef.current = Date.now() + 1500;
      setDetailSuppressedForPlayback(true);
    }
  }, [playbackActive]);

  useEffect(() => {
    if (!launchingPlayback) {
      return;
    }

    if (playbackActive || playbackClosing) {
      setLaunchingPlayback(false);
      return;
    }

    const timeout = setTimeout(() => {
      logMoviesPlayback('launch-timeout', { playbackActive, playbackClosing });
      setLaunchingPlayback(false);
      setDetailSuppressedForPlayback(false);
    }, 12000);

    return () => clearTimeout(timeout);
  }, [launchingPlayback, playbackActive, playbackClosing]);

  useEffect(() => {
    logMoviesPlayback('state', {
      detailOpen,
      detailSuppressedForPlayback,
      detailOverlayVisible,
      launchingPlayback,
      playbackActive,
      playbackClosing,
      playbackUiActive,
      selectedMovieId: selectedMovie?.id ?? null,
    });
  }, [
    detailOpen,
    detailOverlayVisible,
    detailSuppressedForPlayback,
    launchingPlayback,
    playbackActive,
    playbackClosing,
    playbackUiActive,
    selectedMovie?.id,
  ]);
  const selectedMovieRef = useRef(selectedMovie);

  useEffect(() => {
    selectedMovieRef.current = selectedMovie;
  }, [selectedMovie]);

  const movieDetailRef = useRef(movieDetail);

  useEffect(() => {
    movieDetailRef.current = movieDetail;
  }, [movieDetail]);

  const selectedCategory = categories.find((category) => category.id === selectedCategoryId);
  const selectedCategoryLabel = selectedCategory
    ? displayProviderCategoryName({
        name: selectedCategory.name,
        rawName: selectedCategory.rawName,
        countryCode: selectedCategory.countryCode,
        contentType: 'movie',
        kind: selectedCategory.kind,
      })
    : 'All Movies';
  const posterColumns = getSeriesPosterColumns(width);
  const isDiscoverCategory = isFeaturesSmartCategoryId(selectedCategoryId);

  const syncCategoryFocusLeftHandle = useCallback(() => {
    const target = categoryRowRefs.current.get(selectedCategoryId);
    setCategoryFocusLeftHandle(target ? findNodeHandle(target) ?? undefined : undefined);
  }, [selectedCategoryId]);

  useEffect(() => {
    syncCategoryFocusLeftHandle();
  }, [categories.length, selectedCategoryId, syncCategoryFocusLeftHandle]);

  const focusSelectedPoster = useCallback((reason = 'restore-selected-poster') => {
    const restoreId = resolvePosterRestorationId({
      focusedId: getFocusedMovieId() ?? getMoviesScreenMemory(activeProviderId).focusedMovieId,
      selectedId: selectedMovie?.id ?? null,
      availableIds: visibleMovies.map((movie) => movie.id),
    });
    if (!restoreId) {
      return;
    }

    setRestoringBrowseFocus(true);
    requestTvFocus({
      screen: 'movies',
      source: 'MoviesScreen',
      region: 'poster-grid',
      itemId: restoreId,
      reason,
      getTarget: () => getValidatedPosterTarget(restoreId),
      onSettled: () => {
        setRestoringBrowseFocus(false);
      },
    });
  }, [activeProviderId, getFocusedMovieId, getValidatedPosterTarget, selectedMovie?.id, visibleMovies]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchOverlayReady(false);
    focusSelectedPoster('restore-after-search-close');
  }, [focusSelectedPoster]);

  const closeDetail = useCallback(() => {
    beginFocusAuditCycle('movies-detail-close', {
      categoryId: selectedCategoryId,
      movieId: browseFocusSnapshotRef.current?.movieId ?? null,
    });
    setDetailOpen(false);
    detailOpenRef.current = false;
    setDetailSuppressedForPlayback(false);
    const snapshot = browseFocusSnapshotRef.current;
    const restoreId = snapshot?.categoryId === selectedCategoryId ? snapshot.movieId : null;
    const restoreIndex = snapshot?.categoryId === selectedCategoryId ? snapshot.index : -1;
    const token = `detail-${++restorationSequenceRef.current}`;
    console.info('[NovaCast Movies Focus Handoff]', {
      marker: MOVIES_FOCUS_STAGE3B2_MARKER,
      categoryId: selectedCategoryId,
      phase: 'detail-close',
      intendedMovieId: restoreId,
      focusRequested: Boolean(restoreId),
      detailOpened: true,
    });
    if (restoreId) {
      restorationTokenRef.current = {
        token,
        source: 'detail-close',
        categoryId: selectedCategoryId,
        targetMovieId: restoreId,
        targetIndex: restoreIndex,
      };
      restorationIssuedTokenRef.current = null;
      setRestoringBrowseFocus(true);
      return;
    }
    focusSelectedPoster('restore-after-detail-close');
  }, [focusSelectedPoster, selectedCategoryId]);

  useEffect(() => {
    const restore = restorationTokenRef.current;
    if (!restore || detailOpenRef.current || restore.categoryId !== selectedCategoryId) {
      return;
    }

    const availableIds = visibleMovies.map((movie) => movie.id);
    const restoreId = resolvePosterRestorationId({
      focusedId: restore.targetMovieId,
      selectedId: restore.targetMovieId,
      availableIds,
      restorationActive: true,
      targetMovieId: restore.targetMovieId,
    });
    const targetAvailable = Boolean(restoreId);
    const refMounted = targetAvailable && Boolean(getValidatedPosterTarget(restore.targetMovieId, restore.targetIndex));
    console.info('[NovaCast Movies Restore]', {
      token: restore.token,
      source: restore.source,
      categoryId: restore.categoryId,
      targetMovieId: restore.targetMovieId,
      targetIndex: restore.targetIndex,
      targetAvailable,
      refMounted,
      scrollRequested: targetAvailable,
      focusRequested: false,
      outcome: targetAvailable ? 'pending' : 'waiting-for-target',
    });

    if (!targetAvailable || restorationIssuedTokenRef.current === restore.token) {
      return;
    }

    restorationIssuedTokenRef.current = restore.token;
    InteractionManager.runAfterInteractions(() => {
      if (restorationTokenRef.current?.token !== restore.token || detailOpenRef.current) {
        restorationIssuedTokenRef.current = null;
        return;
      }

      requestTvFocus({
        screen: 'movies',
        source: 'MoviesScreen',
        region: 'poster-grid',
        itemId: restore.targetMovieId,
        reason:
          restore.source === 'detail-close'
            ? 'restore-exact-poster-after-detail-close'
            : 'restore-after-playback-exact-poster',
        maxFrames: 30,
        isActive: () =>
          !detailOpenRef.current && restorationTokenRef.current?.token === restore.token,
        getTarget: () => getValidatedPosterTarget(restore.targetMovieId, restore.targetIndex),
        onSettled: (status) => {
          const current = restorationTokenRef.current;
          if (!current || current.token !== restore.token) {
            return;
          }
          console.info('[NovaCast Movies Restore]', {
            token: restore.token,
            source: restore.source,
            categoryId: restore.categoryId,
            targetMovieId: restore.targetMovieId,
            targetIndex: restore.targetIndex,
            targetAvailable: true,
            refMounted: Boolean(getValidatedPosterTarget(restore.targetMovieId, restore.targetIndex)),
            scrollRequested: true,
            focusRequested: status === 'executed',
            outcome: status,
          });
          if (status === 'executed') {
            // Native focus() succeeding is not confirmation. Keep the token
            // until the target card reports the matching onFocus event.
          } else if (status === 'timeout') {
            restorationIssuedTokenRef.current = null;
            setTimeout(() => setRestorationRetry((value) => value + 1), 0);
          }
        },
      });
    });
  }, [getValidatedPosterTarget, restorationRetry, restoringBrowseFocus, selectedCategoryId, visibleMovies]);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (guide.visible) {
        if (isUnifiedRemoteDebugEnabled()) {
          logUnifiedRemoteEvent({
            source: 'BackHandler',
            eventType: 'hardwareBackPress',
            disposition: 'consumed',
            actionTaken: 'ignored-guide-visible',
          });
        }
        return true;
      }

      if (playbackClosing || launchingPlayback || playbackActive) {
        if (isUnifiedRemoteDebugEnabled()) {
          logUnifiedRemoteEvent({
            source: 'BackHandler',
            eventType: 'hardwareBackPress',
            disposition: 'consumed',
            actionTaken: playbackClosing || launchingPlayback ? 'ignored-playback-closing' : 'movies-shell-close-playback',
          });
        }
        if (playbackActive && !playbackClosing) {
          closePlayback();
        }
        return true;
      }

      if (shouldHandleMoviesDetailBack({ playbackUiActive: false, detailOpen })) {
        closeDetail();
        return true;
      }

      if (searchOpen) {
        closeSearch();
        return true;
      }

      const action = decideMoviesBackAction(playbackActive, isRestoringPlaybackFocusRef.current);

      if (isUnifiedRemoteDebugEnabled()) {
        logUnifiedRemoteEvent({
          source: 'BackHandler',
          eventType: 'hardwareBackPress',
          disposition: action === 'leave-screen' ? 'accepted' : 'consumed',
          actionTaken: `movies-shell-${action}`,
        });
      }

      if (action === 'close-playback') {
        closePlayback();
        return true;
      }

      if (action === 'swallow') {
        return true;
      }

      if (!tryAcquireTvNavigationGate(navigationGateRef.current)) {
        return true;
      }

      router.replace(TV_HOME_ROUTE);
      return true;
    });

    return () => subscription.remove();
  }, [closeDetail, closePlayback, closeSearch, detailOpen, guide.visible, launchingPlayback, playbackActive, playbackClosing, router, searchOpen]);

  useEffect(() => {
    if (!didJustClose) {
      return;
    }

    setDetailOpen(false);
    detailOpenRef.current = false;
    setDetailSuppressedForPlayback(false);
    setLaunchingPlayback(false);
    finishUnifiedPlaybackClose();

    const snapshot = browseFocusSnapshotRef.current;
    const restoreId = snapshot?.categoryId === selectedCategoryId ? snapshot.movieId : selectedMovie?.id;
    if (!restoreId) {
      return;
    }
    const token = `playback-${++restorationSequenceRef.current}`;
    restorationTokenRef.current = {
      token,
      source: 'playback-close',
      categoryId: selectedCategoryId,
      targetMovieId: restoreId,
      targetIndex: snapshot?.index ?? visibleMovies.findIndex((movie) => movie.id === restoreId),
    };
    restorationIssuedTokenRef.current = null;
    isRestoringPlaybackFocusRef.current = true;
    setRestoringBrowseFocus(true);
    setRestorationRetry((value) => value + 1);
  }, [didJustClose, selectedCategoryId, selectedMovie?.id, visibleMovies]);

  useEffect(() => {
    rememberMoviesScreenMemory(activeProviderId, {
      selectedCategoryId,
      // Focus is persisted from focusMovie/selectMovie — do not overwrite from
      // stale focusedMovie state (focus no longer updates that state on D-pad move).
      selectedMovieId: selectedMovie?.id ?? getMoviesScreenMemory(activeProviderId).selectedMovieId,
    });
  }, [activeProviderId, selectedCategoryId, selectedMovie?.id]);

  const startPlayback = useCallback(async () => {
    const requestedMovie = selectedMovieRef.current;

    logMoviesPlayback('play-requested', {
      hasBundle: Boolean(bundle),
      movieId: requestedMovie?.id ?? null,
      playbackActive,
      playbackClosing,
      inFlight: playbackLaunchInFlightRef.current,
    });

    if (!bundle || !requestedMovie) {
      logMoviesPlayback('play-blocked', { reason: 'missing-movie-or-bundle' });
      return;
    }

    if (playbackActive || playbackClosing || playbackLaunchInFlightRef.current) {
      logMoviesPlayback('play-blocked', { reason: 'playback-busy' });
      return;
    }

    const now = Date.now();
    if (now - lastPlaybackLaunchAtRef.current < 800) {
      logMoviesPlayback('play-blocked', { reason: 'debounce' });
      return;
    }

    playbackLaunchInFlightRef.current = true;
    setLaunchingPlayback(true);

    try {
      const pendingDetailPromise = pendingDetailPromiseRef.current;

      if (pendingDetailPromise) {
        logMoviesPlayback('detail-wait-start', {
          movieId: requestedMovie.id,
        });

        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

        await Promise.race([
          pendingDetailPromise,
          new Promise<void>((resolve) => {
            timeoutHandle = setTimeout(resolve, 4000);
          }),
        ]);

        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }

        logMoviesPlayback('detail-wait-finished', {
          movieId: requestedMovie.id,
        });
      }

      const currentMovie = selectedMovieRef.current;

      if (!currentMovie || currentMovie.id !== requestedMovie.id) {
        logMoviesPlayback('play-blocked', {
          reason: 'movie-selection-changed',
        });
        return;
      }

      const latestMovieDetail = movieDetailRef.current;
      const matchingDetail =
        latestMovieDetail?.id === currentMovie.id
          ? latestMovieDetail
          : null;

      const streamUrl = buildMoviePlaybackUrlResolved(
        bundle,
        currentMovie.id,
        matchingDetail?.containerExtension,
        currentMovie.containerExtension,
      );

      if (!streamUrl) {
        showNotification({
          id: PLAYBACK_NOTIFICATION_ID,
          type: 'error',
          title: 'Playback unavailable',
          message: 'This movie stream URL could not be built.',
          duration: PLAYBACK_NOTIFICATION_DURATION_MS,
          position: 'bottom-right',
          scope: 'movies',
        });
        return;
      }

      lastPlaybackLaunchAtRef.current = Date.now();
      playFocusGuardUntilRef.current = Date.now() + 2000;
      setDetailSuppressedForPlayback(true);
      dismissNotification(PLAYBACK_NOTIFICATION_ID);

      logMoviesPlayback('launch-start', {
        movieId: currentMovie.id,
      });

      await launchPlayback(
        {
          id: currentMovie.id,
          mediaType: 'movie',
          title: currentMovie.title,
          streamUrl,
          artworkUrl: currentMovie.posterUrl,
          isLive: false,
          providerId: activeProviderId,
        },
        {
          launchSource: 'play',
          contentFit: 'cover',
        },
      );
    } catch {
      logMoviesPlayback('launch-failed', {
        movieId: requestedMovie.id,
      });

      setDetailSuppressedForPlayback(false);

      showNotification({
        id: PLAYBACK_NOTIFICATION_ID,
        type: 'error',
        title: 'Playback unavailable',
        message: 'This movie could not start playing right now.',
        duration: PLAYBACK_NOTIFICATION_DURATION_MS,
        position: 'bottom-right',
        scope: 'movies',
      });
    } finally {
      playbackLaunchInFlightRef.current = false;
      setLaunchingPlayback(false);
    }
  }, [
    activeProviderId,
    bundle,
    dismissNotification,
    launchPlayback,
    playbackActive,
    playbackClosing,
    showNotification,
  ]);

  const handleSearchSelect = useCallback(
    (result: SearchResult) => {
      if (result.type !== 'movie') {
        return;
      }

      setSearchOpen(false);
      setSearchOverlayReady(false);
      const movie = {
        id: result.id,
        categoryId: result.categoryId ?? selectedCategoryId,
        title: result.title,
        year: result.year,
        rating: result.rating,
        genres: result.genres ?? ['Movies'],
        posterUrl: result.posterUrl,
        posterStyleKey: 'ember' as const,
        description: 'Curated from your NovaCast movie library.',
      };
      selectMovie(movie);
      focusMovie(movie);
      void loadMovieDetail(movie);
      setDetailSuppressedForPlayback(false);
      setDetailOpen(true);
    },
    [focusMovie, loadMovieDetail, selectMovie, selectedCategoryId],
  );

  const executeMovieSearch = useCallback(
    (request: Parameters<typeof searchMovies>[2]) => searchMovies(activeProviderId, bundle?.movies, request),
    [activeProviderId, bundle?.movies],
  );

  const searchBlocksBrowse = searchOverlayReady;

  const handleReload = useCallback(() => {
    const now = Date.now();
    if (now - lastRetryAtRef.current < 400) {
      return;
    }

    lastRetryAtRef.current = now;
    moviesRetryAttemptedRef.current = true;
    void reload();
  }, [reload]);

  const handleDetailRetry = useCallback(() => {
    const movie = selectedMovieRef.current;
    if (!movie) {
      return;
    }

    moviesDetailRetryAttemptedRef.current = true;
    void loadMovieDetail(movie);
  }, [loadMovieDetail]);

  const handleSelectCategory = useCallback(
    (categoryId: string) => {
      moviesRetryAttemptedRef.current = false;
      categoryFocusPendingRef.current = categoryId;
      setRestoringBrowseFocus(true);
      console.info('[NovaCast Movies Focus Handoff]', {
        marker: MOVIES_FOCUS_STAGE3B2_MARKER,
        categoryId,
        phase: 'category-loading',
        intendedMovieId: null,
        focusRequested: false,
        detailOpened: false,
      });
      selectCategory(categoryId);
    },
    [selectCategory],
  );


  useEffect(() => {
    const pendingCategoryId = categoryFocusPendingRef.current;
    if (!pendingCategoryId || pendingCategoryId !== selectedCategoryId) {
      return;
    }

    if (restorationTokenRef.current?.categoryId === selectedCategoryId) {
      return;
    }

    if (categoryLoading || loadStatus === 'loading') {
      return;
    }

    const targetId = visibleMovies[0]?.id ?? null;
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
        screen: 'movies',
        source: 'MoviesScreen',
        region: 'poster-grid',
        itemId: targetId,
        reason: 'focus-first-movies-after-category',
        isActive: () =>
          !cancelled &&
          categoryFocusPendingRef.current === selectedCategoryId,
        getTarget: () => getValidatedPosterTarget(targetId),
        onSettled: () => {
          if (cancelled) {
            return;
          }
          categoryFocusPendingRef.current = null;
          setRestoringBrowseFocus(false);
        },
      });
      console.info('[NovaCast Movies Focus Handoff]', {
        marker: MOVIES_FOCUS_STAGE3B2_MARKER,
        categoryId: selectedCategoryId,
        phase: 'category-to-grid',
        intendedMovieId: targetId,
        focusRequested: true,
        detailOpened: false,
      });
    });

    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [categoryLoading || loadStatus === 'loading', getValidatedPosterTarget, selectedCategoryId, visibleMovies]);
useEffect(() => {
    if (loadStatus === 'ready') {
      moviesRetryAttemptedRef.current = false;
    }
  }, [loadStatus]);

  useEffect(() => {
    if (!detailError) {
      moviesDetailRetryAttemptedRef.current = false;
    }
  }, [detailError]);

  useEffect(() => {
    if (!hasDataSource || categories.length === 0) {
      dismissNotification(MOVIES_LOAD_NOTIFICATION_ID);
      return;
    }

    const spec = resolveMoviesNotificationForStatus(loadStatus, moviesRetryAttemptedRef.current, loadErrorMessage);
    if (!spec) {
      dismissNotification(MOVIES_LOAD_NOTIFICATION_ID);
      return;
    }

    showNotification({
      id: MOVIES_LOAD_NOTIFICATION_ID,
      type: 'error',
      title: spec.title,
      message: spec.message,
      duration: MOVIES_NOTIFICATION_DURATION_MS,
      persistent: spec.persistent,
      position: 'bottom-right',
      scope: 'movies',
    });
  }, [categories.length, dismissNotification, hasDataSource, loadErrorMessage, loadStatus, showNotification]);

  useEffect(() => {
    if (!detailOpen || !detailError) {
      dismissNotification(MOVIES_DETAIL_NOTIFICATION_ID);
      return;
    }

    const spec = resolveMoviesDetailNotification(moviesDetailRetryAttemptedRef.current, detailError);
    showNotification({
      id: MOVIES_DETAIL_NOTIFICATION_ID,
      type: 'warning',
      title: spec.title,
      message: spec.message,
      duration: MOVIES_NOTIFICATION_DURATION_MS,
      persistent: spec.persistent,
      position: 'bottom-right',
      scope: 'movies',
    });
  }, [detailError, detailOpen, dismissNotification, showNotification]);

  useEffect(() => {
    return () => {
      clearScope('movies');
    };
  }, [clearScope]);

  const gridEmptyNotice =
    !loading && visibleMovies.length === 0 && loadStatus === 'error'
      ? 'No movies to display right now.'
      : !loading && visibleMovies.length === 0 && loadStatus === 'empty'
        ? 'No movies in this category.'
        : null;
  const showMoviesVisualLoader =
    (categories.length === 0 && loadStatus !== 'error') ||
    (categoryLoading || loadStatus === 'loading');

  useEffect(() => {
    console.info('[NovaCast Movies Visual Loader]', {
      visible: showMoviesVisualLoader,
      reason: categories.length === 0 ? 'initial-category-load' : 'category-first-page-load',
      categoryId: selectedCategoryId,
      firstPageLoading: categoryLoading || loadStatus === 'loading',
      hasUsableItems: visibleMovies.length > 0,
    });
  }, [categories.length, categoryLoading, loadStatus, selectedCategoryId, showMoviesVisualLoader, visibleMovies.length]);

  useEffect(() => {
    if (categoryLoading || loadStatus === 'loading') {
      recordFocusAudit({
        component: 'MoviesScreen.loader-anchor',
        action: 'hasTVPreferredFocus',
        itemId: selectedCategoryId,
        detail: {
          preferred: Boolean(restoringBrowseFocus && categoryFocusPendingRef.current === selectedCategoryId),
        },
      });
    }
  }, [categoryLoading, loadStatus, restoringBrowseFocus, selectedCategoryId]);

  if (!hasDataSource) {
    return (
      <NovaTvShell activeId="movies" preferActiveNavigationFocus={false} compactNavigationRail>
        <View style={styles.emptyState}>
          <MaterialCommunityIcons name="alert-circle-outline" size={34} color={theme.colors.warning} />
          <Text style={styles.emptyTitle}>Movies unavailable</Text>
          <Text style={styles.emptyCopy}>Connect a provider to browse your movie library.</Text>
        </View>
      </NovaTvShell>
    );
  }

  if (categories.length === 0 && loadStatus === 'error') {
    return (
      <NovaTvShell activeId="movies" preferActiveNavigationFocus={false} compactNavigationRail>
        <View style={styles.emptyState}>
          <MaterialCommunityIcons name="alert-circle-outline" size={34} color={theme.colors.warning} />
          <Text style={styles.emptyTitle}>Movies unavailable</Text>
          <Text style={styles.emptyCopy}>{loadErrorMessage ?? 'Unable to load movie categories from your provider.'}</Text>
          <Pressable
            focusable
            hasTVPreferredFocus
            accessibilityRole="button"
            accessibilityLabel="Retry Movies"
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
      <>
      <View
        style={[styles.browseLayer, playbackUiActive && styles.browseLayerHidden]}
        pointerEvents={detailOpen || searchBlocksBrowse || playbackUiActive ? 'none' : 'auto'}
        importantForAccessibility={
          detailOpen || searchBlocksBrowse || playbackUiActive ? 'no-hide-descendants' : 'auto'
        }
        accessibilityElementsHidden={detailOpen || searchBlocksBrowse || playbackUiActive}>
      <NovaTvShell
        activeId="movies"
        providerLabel={selectedProviderLabel}
        preferActiveNavigationFocus={moviesFocusOwner === 'navbar'}
        suppressNavbarPreferredFocus={moviesFocusOwner !== 'navbar'}
        compactNavigationRail>
        <View style={styles.screen}>
          <View style={styles.topBar}>
            <View style={styles.headingBlock}>
              <Text style={styles.heading}>Movies</Text>
              <Text style={styles.copy}>Thousands of movies. Any genre. Anytime.</Text>
            </View>
            <MovieToolbar
              onSearchPress={() => {
                logMoviesPlayback('search-open', {});
                if (searchOpen) {
                  closeSearch();
                  return;
                }

                setSearchOpen(true);
              }}
            />
          </View>

          <View style={styles.contentRow}>
            <MovieCategoryRail
              categories={categories}
              selectedCategoryId={selectedCategoryId}
              preferredCategoryId={moviesMemory.selectedCategoryId}
              focusOwner={moviesFocusOwner}
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
                  <NovaSpaceLoader label="Loading movie categories…" />
                </View>
              ) : (categoryLoading || loadStatus === 'loading') && visibleMovies.length === 0 ? (
                <View style={styles.initialLoadingPanel}>
                  <Pressable
                    focusable
                    hasTVPreferredFocus={moviesFocusOwner === 'loading-anchor'}
                    accessibilityRole="none"
                    accessibilityLabel="Movies loading"
                    onPress={() => undefined}
                    style={styles.loadingFocusAnchor}
                  />
                  <NovaSpaceLoader label="Loading movies…" />
                </View>
              ) : (
              <MoviePosterGrid
                movies={visibleMovies}
                selectedCategoryLabel={selectedCategoryLabel}
                selectedCategoryId={selectedCategoryId}
                columns={posterColumns}
                hasMore={hasMore}
                loading={loading}
                categoryLoading={categoryLoading || loadStatus === 'loading'}
                emptyNotice={gridEmptyNotice}
                selectedMovieId={selectedMovie?.id ?? null}
                suppressPreferredFocus={Boolean(restorationTokenRef.current)}
                focusOwner={moviesFocusOwner}
                postersFocusable={!detailOpen && !playbackUiActive && !searchBlocksBrowse}
                onFocusMovie={handleFocusMovie}
                onSelectMovie={handleSelectMovie}
                registerPosterRef={handleRegisterPosterRef}
                sortOption={sortOption}
                onSortChange={setSort}
                showRatingSort={categoryHasRatings}
                isDiscover={isDiscoverCategory}
                sortFocusLeftHandle={categoryFocusLeftHandle}
                onSortFocusHandleReady={setSortFocusRightHandle}
                loadMore={handleLoadMore}
                restoreMovieId={restorationTokenRef.current?.targetMovieId ?? null}
                restoreMovieIndex={restorationTokenRef.current?.targetIndex ?? null}
              />
              )}
            </View>

          </View>
        </View>
      </NovaTvShell>
        </View>

      <MediaDetailOverlay
        visible={detailOverlayVisible}
        detail={
          selectedMovie
            ? movieDetail?.id === selectedMovie.id
              ? movieDetail
              : buildMoviePreviewDetail(selectedMovie)
            : null
        }
        detailError={null}
        detailLoading={detailLoading}
        isFavorite={selectedMovie ? library.isFavorite(selectedMovie.id) : false}
        isWatchlisted={selectedMovie ? library.isWatchlisted(selectedMovie.id) : false}
        onClose={closeDetail}
        onPlay={selectedMovie ? startPlayback : undefined}
        onRetry={selectedMovie ? handleDetailRetry : undefined}
        onTrailerPress={
          movieDetail?.trailerUrl
            ? () => {
                void Linking.openURL(movieDetail.trailerUrl!);
              }
            : undefined
        }
        onFavoritePress={
          selectedMovie
            ? () => {
                void toggleFavorite(activeProviderId, selectedMovie.id);
              }
            : undefined
        }
        onWatchlistPress={
          selectedMovie
            ? () => {
                void toggleWatchlist(activeProviderId, selectedMovie.id);
              }
            : undefined
        }
      />
        </>

      <SearchOverlay
        visible={searchOpen && !playbackUiActive}
        scope="movie"
        providerId={activeProviderId}
        title="Search Movies"
        executeSearch={executeMovieSearch}
        onReady={() => setSearchOverlayReady(true)}
        onClose={closeSearch}
        onSelectResult={handleSearchSelect}
      />

      <WalkthroughOverlay
        key={guide.visible ? 'movies-guide-open' : 'movies-guide-closed'}
        visible={guide.visible && !playbackUiActive}
        title={ONBOARDING_GUIDES.movies.title}
        steps={ONBOARDING_GUIDES.movies.steps}
        onDismiss={guide.dismiss}
        onSkip={guide.skip}
        onDontShowAgain={guide.dontShowAgain}
        onComplete={guide.complete}
      />
    </View>
  );
}

function createMoviesStyles(theme: NovaTheme) {
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
      paddingBottom: 48,
    },
    loadingFocusAnchor: {
      position: 'absolute',
      width: 2,
      height: 2,
      opacity: 0.01,
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
