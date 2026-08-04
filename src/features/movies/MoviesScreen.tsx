import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { ElementRef } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactNative, {
  AppState,
  BackHandler,
  findNodeHandle,
  InteractionManager,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { BlurView } from 'expo-blur';
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
import { MovieDetailOverlay } from './components/MovieDetailOverlay';
import { MoviePosterGrid } from './components/MoviePosterGrid';
import { MovieToolbar } from './components/MovieToolbar';
import {
  resolveContinueWatchingLabel,
  MOVIE_DETAIL_RELATED_LIMIT,
  selectRelatedMovies,
} from './movieDetailOverlayModel';
import { getMoviesScreenMemory, rememberMoviesScreenMemory } from './moviesScreenMemory';
import { useMoviesScreenModel } from './useMoviesScreenModel';
import { getMovieCategoryRailCategories } from './moviesVisibleCategories';
import {
  beginMoviePlaybackLifecycle,
  logMoviePlaybackShape,
  markMoviePlaybackLifecycle,
  noteMoviePlaybackFailed,
} from './moviesPlaybackAudit';

import { buildMoviePreviewDetail } from '@/features/media-browser/mediaDetail';
import {
  resolvePosterRestorationId,
  shouldPreferNavigationFocus,
} from '@/features/media-browser/posterGridFocusPolicy';
import { requestTvFocus } from '@/features/navigation/tvFocusDiagnostics';
import { beginFocusAuditCycle, recordFocusAudit } from '@/features/navigation/focusRequestAudit';
import {
  captureOnnMoviesScreenState,
  getOnnMoviesGridInstanceId,
  isOnnMoviesGridMounted,
  isOnnMoviesTraceEnabled,
  maybeBeginOnnMoviesAutoTrace,
  noteOnnMoviesMount,
  noteOnnMoviesRender,
  noteOnnMoviesUnmount,
  traceOnnMoviesEvent,
  traceOnnMoviesScrollSample,
  wrapOnnMoviesBackHandler,
} from '@/features/diagnostics/onnMoviesTrace';
import { PLAYBACK_NOTIFICATION_DURATION_MS, PLAYBACK_NOTIFICATION_ID } from '@/features/playback/unified/unifiedPlayerLogic';
import { SearchOverlay } from '@/features/search/SearchOverlay';
import { searchMovies } from '@/features/search/repositories/movieSearchRepository';
import { resolveMoviesSearchDatasource } from '@/features/search/moviesSearchDatasource';
import { runMoviesSearchPerfProbeOnce } from '@/features/search/moviesSearchPerfProbe';
import {
  isMoviesSearchOverlayMounted,
  isMoviesSearchOverlayVisible,
  logMoviesSearchReopen,
  logMoviesSearchSelection,
  movieSummaryFromSearchResult,
  shouldBlockMoviesSearchToolbar,
  shouldToggleCloseMoviesSearch,
  type MoviesDetailSource,
  type MoviesSearchPhase,
} from '@/features/search/moviesSearchSelection';
import {
  logMoviesSearchPlayback,
  validateSearchPlaybackMovie,
} from '@/features/search/moviesSearchPlayback';
import { getActiveMoviesSearchRequestId } from '@/features/search/moviesSearchPerfDiagnostics';
import { createSqliteMovieDataSource } from './data/SqliteMovieDataSource';
import type { SearchResult } from '@/features/search/searchTypes';
import {
  getMoviesOnnTraceSnapshot,
  setMoviesDetailOpenForDiagnostics,
  setMoviesOnnTraceSnapshot,
} from './moviesDiagnosticsState';
import {
  deriveMoviesPaginationLoaderMode,
  deriveMoviesPrimaryLoaderModeFromGate,
  isMoviesPrimaryLoaderGateVisible,
  logMoviesPaginationLoader,
  logMoviesPrimaryLoader,
  MOVIES_PAGINATION_LOADER_LABEL,
  MOVIES_PRIMARY_LOADER_MIN_MS,
  resolveMoviesPrimaryLoaderLabel,
  type MoviesPaginationLoaderMode,
  type MoviesPrimaryLoaderHideReason,
  type MoviesPrimaryLoaderMode,
} from './moviesLoaderState';
import {
  MOVIES_DETAIL_FOCUS_CONFIRM_TIMEOUT_MS,
  MOVIES_FOCUS_STAGE4F_MARKER,
  MOVIES_FOCUS_SUPPRESSION_RELEASE_MS,
  MOVIES_MAX_FOCUS_REQUESTS,
  MOVIES_MAX_VIEWPORT_RESTORES,
  MOVIES_MOUNTED_FOCUS_MAX_FRAMES,
  MOVIES_OFFSCREEN_FOCUS_MAX_FRAMES,
  MOVIES_POST_RESTORE_LATCH_MS,
  MOVIES_VIEWPORT_OFFSET_TOLERANCE_PX,
  areMoviesChromeNormallyFocusable,
  areMoviesPostersNormallyFocusable,
  canBeginMoviesDetailClose,
  createMoviesBrowseFocusSnapshot,
  createMoviesPostRestoreLatch,
  createMoviesRestoreTiming,
  isMoviesBrowseSnapshotImmutable,
  isMoviesDetailClosingPhase,
  isMoviesDetailFocusConfirmed,
  isMoviesDetailOverlayMounted,
  isMoviesDetailReturnFastPath,
  isMoviesFocusSuppressionActive,
  isMoviesNativeFocusRowAlignmentDrift,
  isMoviesPostRestoreLatchActive,
  isMoviesViewportOffsetStable,
  logMoviesDetailFocusConflict,
  logMoviesDetailFocusLifecycle,
  logMoviesFocusSuppression,
  logMoviesPostRestoreFocus,
  logMoviesRestoreTiming,
  logMoviesSearchFocusBlocked,
  logMoviesViewportLock,
  resolveMoviesClosingFocusableMovieId,
  resolveMoviesDetailReturnMaxViewportRestores,
  resolveNearestVisiblePoster,
  selectMoviesDetailReturnPath,
  shouldIssueMoviesInitialDetailRestore,
  shouldReRequestMoviesPosterFocusAfterCorrective,
  shouldSkipZeroDeltaInitialRestore,
  shouldSuppressMoviesCategoryFocus,
  shouldSuppressMoviesNavbarFocus,
  wasMoviesSnapshotTargetVisible,
  type MoviesBrowseFocusSnapshot,
  type MoviesDetailFocusPhase,
  type MoviesDetailFocusToken,
  type MoviesDetailOpenContext,
  type MoviesDetailReturnPath,
  type MoviesPostRestoreLatch,
  type MoviesPostRestoreReleaseReason,
  type MoviesRestoreTimingState,
} from './moviesDetailFocusLifecycle';
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

const MOVIES_FOCUS_STAGE3D1_MARKER = 'stage3d1-movies-viewport-lock-v2';
const MOVIES_FOCUS_STAGE3D2_MARKER = 'stage3d2-movies-post-restore-focus-v1';
const MOVIES_FOCUS_STAGE3D3_MARKER = 'stage3d3-movies-restore-polish-v1';
const MOVIES_FOCUS_STAGE3B2_MARKER = 'stage3b2-movies-focus-loader-polish-v1';
const MOVIES_FOCUS_STAGE3D_MARKER = 'stage3d-movies-detail-focus-lifecycle-v1';

type MoviesTvEventPayload = {
  eventType: string;
};

function noopUseMoviesTvEventHandler(_handler: (event: MoviesTvEventPayload) => void) {}

console.info('[NovaCast Movies Diagnostics Build] ' + JSON.stringify({ version: 'movies-detail-focus-lifecycle-v1' }));

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
  const browseFocusSnapshotRef = useRef<MoviesBrowseFocusSnapshot | null>(null);
  const detailOpenContextRef = useRef<MoviesDetailOpenContext | null>(null);
  const detailReturnPathRef = useRef<MoviesDetailReturnPath | null>(null);
  const viewportStateRef = useRef({ offset: 0, firstIndex: null as number | null, lastIndex: null as number | null });
  const detailFocusTokenRef = useRef<MoviesDetailFocusToken | null>(null);
  const focusIssuedTokenRef = useRef<string | null>(null);
  const scrollIssuedTokenRef = useRef<string | null>(null);
  const restoreScrollBlockedRef = useRef(false);
  const viewportRestoreCountRef = useRef(0);
  const focusRequestCountRef = useRef(0);
  const targetFocusConfirmedRef = useRef(false);
  const viewportStableRef = useRef(false);
  const suppressionReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restorationSequenceRef = useRef(0);
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overlayCloseTargetRef = useRef<ElementRef<typeof Pressable> | null>(null);
  const browseLayerRef = useRef<View | null>(null);
  const [detailFocusPhase, setDetailFocusPhase] = useState<MoviesDetailFocusPhase>('browse');
  const detailFocusPhaseRef = useRef<MoviesDetailFocusPhase>('browse');
  const [categoryFocusLeftHandle, setCategoryFocusLeftHandle] = useState<number | undefined>();
  const [sortFocusRightHandle, setSortFocusRightHandle] = useState<number | undefined>();
  const isRestoringPlaybackFocusRef = useRef(false);
  const [restoringBrowseFocus, setRestoringBrowseFocus] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const detailOpenRef = useRef(false);
  const previousMoviesDataRef = useRef<unknown>(null);
  const moviesAuditRef = useRef<{ selectedMovieId: string | null; focusedMovieId: string | null }>({
    selectedMovieId: null,
    focusedMovieId: null,
  });
  const [restorationRetry, setRestorationRetry] = useState(0);
  const [detailSuppressedForPlayback, setDetailSuppressedForPlayback] = useState(false);
  const [closingFocusMovieId, setClosingFocusMovieId] = useState<string | null>(null);
  const [viewportRestoreCommand, setViewportRestoreCommand] = useState<{
    token: string;
    offset: number;
    reason: 'initial' | 'corrective';
  } | null>(null);
  const [focusSuppressionHeld, setFocusSuppressionHeld] = useState(false);
  const [postRestoreLatch, setPostRestoreLatch] = useState<MoviesPostRestoreLatch | null>(null);
  const postRestoreLatchRef = useRef<MoviesPostRestoreLatch | null>(null);
  const postRestoreTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actualFocusedComponentRef = useRef<string | null>(null);
  const restoreTimingRef = useRef<MoviesRestoreTimingState | null>(null);
  const [lockScrollForFocusRestore, setLockScrollForFocusRestore] = useState(false);
  const [searchPhase, setSearchPhase] = useState<MoviesSearchPhase>('closed');
  const searchPhaseRef = useRef<MoviesSearchPhase>('closed');
  const [searchOverlayReady, setSearchOverlayReady] = useState(false);
  const [searchRestoreMovieId, setSearchRestoreMovieId] = useState<string | null>(null);
  const [detailSource, setDetailSource] = useState<MoviesDetailSource>('browse');
  const detailSourceRef = useRef<MoviesDetailSource>('browse');
  const searchQueryForSelectionRef = useRef('');
  const searchOpen = isMoviesSearchOverlayMounted(searchPhase);
  const searchOverlayVisible = isMoviesSearchOverlayVisible(searchPhase);
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
    visibleMovieCategories,
    selectedCategoryId,
    selectedMovie,
    visibleMovies,
    loading,
    categoryLoading,
    loadStatus,
    catalogRepairing,
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
    getListOffset,
    firstPageLoadGate,
  } = useMoviesScreenModel(undefined, {
    initialSelectedCategoryId: moviesMemory.selectedCategoryId,
    initialFocusedMovieId: moviesMemory.focusedMovieId,
    initialSelectedMovieId: moviesMemory.selectedMovieId,
  });
  // Diagnostics-only mirror so audit logs report current selection/focus
  // without widening effect dependencies.
  moviesAuditRef.current.selectedMovieId = selectedMovie?.id ?? null;
  moviesAuditRef.current.focusedMovieId = getFocusedMovieId();
  if (isOnnMoviesTraceEnabled()) {
    noteOnnMoviesRender('MoviesScreen');
  }
  const detailCloseSourceRef = useRef<'back' | 'x' | 'other'>('other');
  const gridGateOpenRef = useRef<boolean | null>(null);
  const playbackUiActive = playbackActive || playbackClosing || launchingPlayback;
  const detailClosing = isMoviesDetailClosingPhase(detailFocusPhase);
  const detailOverlayMounted = isMoviesDetailOverlayMounted(detailFocusPhase);
  const detailOverlayVisible =
    detailOverlayMounted && !detailSuppressedForPlayback && !playbackUiActive && Boolean(selectedMovie);
  const focusHandoffActive = detailClosing;
  const focusSuppressionActive =
    focusSuppressionHeld ||
    isMoviesFocusSuppressionActive(detailFocusPhase) ||
    detailOverlayVisible ||
    detailSuppressedForPlayback ||
    restoringBrowseFocus;
  const postRestoreActive = isMoviesPostRestoreLatchActive(postRestoreLatch);
  // Preferred-focus gates (Stage 3D.2): independent of native focusability.
  const navbarPreferredSuppressed =
    shouldSuppressMoviesNavbarFocus(detailFocusPhase) || focusSuppressionActive || postRestoreActive;
  const categoryPreferredSuppressed =
    shouldSuppressMoviesCategoryFocus(detailFocusPhase) || focusSuppressionActive || postRestoreActive;
  // Stage 3D.3: chrome may be focusable after latch release only — not during postRestoreActive.
  const chromeFocusable =
    areMoviesChromeNormallyFocusable(detailFocusPhase) &&
    !detailOpen &&
    !playbackUiActive &&
    !postRestoreActive;
  const activeClosingFocusMovieId = resolveMoviesClosingFocusableMovieId({
    phase: detailFocusPhase,
    targetMovieId: closingFocusMovieId,
  });
  const postRestorePreferredMovieId = postRestoreActive ? postRestoreLatch!.restoredMovieId : null;
  const pinnedHighlightMovieId =
    postRestorePreferredMovieId ??
    activeClosingFocusMovieId ??
    (detailClosing ? closingFocusMovieId : null);
  const activeSnapshot = detailFocusTokenRef.current?.snapshot ?? browseFocusSnapshotRef.current;
  const snapshotTargetWasVisible = activeSnapshot
    ? wasMoviesSnapshotTargetVisible(activeSnapshot)
    : false;

  const setDetailFocusPhaseSafe = useCallback((phase: MoviesDetailFocusPhase) => {
    const previous = detailFocusPhaseRef.current;
    detailFocusPhaseRef.current = phase;
    setDetailFocusPhase(phase);
    if (isOnnMoviesTraceEnabled() && previous !== phase) {
      const phaseEvent =
        phase === 'closing-prepare'
          ? 'closing_prepare'
          : phase === 'closing-viewport'
            ? 'closing_viewport'
            : phase === 'closing-focus'
              ? 'closing_focus'
              : phase === 'browse-restored'
                ? 'browse_restored'
                : phase === 'detail-open'
                  ? 'detail_open_phase'
                  : 'detail_phase_changed';
      traceOnnMoviesEvent('Focus', phaseEvent, {
        previousPhase: previous,
        phase,
        selectedCategoryId,
        selectedMovieId: moviesAuditRef.current.selectedMovieId,
        focusedMovieId: moviesAuditRef.current.focusedMovieId,
        gridMounted: isOnnMoviesGridMounted(),
        gridInstanceId: getOnnMoviesGridInstanceId(),
        listOffset: viewportStateRef.current.offset,
        firstVisibleIndex: viewportStateRef.current.firstIndex,
        lastVisibleIndex: viewportStateRef.current.lastIndex,
      });
    }
  }, [selectedCategoryId]);

  const releasePostRestoreLatch = useCallback((reason: MoviesPostRestoreReleaseReason) => {
    const latch = postRestoreLatchRef.current;
    if (!latch?.postRestoreActive) {
      return;
    }
    if (postRestoreTimeoutRef.current) {
      clearTimeout(postRestoreTimeoutRef.current);
      postRestoreTimeoutRef.current = null;
    }
    const released: MoviesPostRestoreLatch = { ...latch, postRestoreActive: false };
    postRestoreLatchRef.current = released;
    setPostRestoreLatch(released);
    logMoviesPostRestoreFocus({
      token: latch.token,
      restoredMovieId: latch.restoredMovieId,
      phase: detailFocusPhaseRef.current,
      postRestoreActive: false,
      searchPreferred: false,
      navbarPreferred: false,
      categoryPreferred: false,
      firstPosterPreferred: false,
      actualFocusedComponent: actualFocusedComponentRef.current,
      releaseReason: reason,
    });
  }, []);

  const activatePostRestoreLatch = useCallback(
    (token: string | null, movieId: string) => {
      if (postRestoreTimeoutRef.current) {
        clearTimeout(postRestoreTimeoutRef.current);
        postRestoreTimeoutRef.current = null;
      }
      const latch = createMoviesPostRestoreLatch({ token, restoredMovieId: movieId });
      postRestoreLatchRef.current = latch;
      setPostRestoreLatch(latch);
      actualFocusedComponentRef.current = 'MoviePosterCard';
      logMoviesPostRestoreFocus({
        token: latch.token,
        restoredMovieId: latch.restoredMovieId,
        phase: 'browse-restored',
        postRestoreActive: true,
        searchPreferred: false,
        navbarPreferred: false,
        categoryPreferred: false,
        firstPosterPreferred: false,
        actualFocusedComponent: 'MoviePosterCard',
        releaseReason: null,
      });
      console.info(
        '[NovaCast Movies Post Restore Latch] ' +
          JSON.stringify({
            marker: MOVIES_FOCUS_STAGE3D2_MARKER,
            token: latch.token,
            restoredMovieId: latch.restoredMovieId,
            latchMs: MOVIES_POST_RESTORE_LATCH_MS,
          }),
      );
      postRestoreTimeoutRef.current = setTimeout(() => {
        postRestoreTimeoutRef.current = null;
        releasePostRestoreLatch('timeout');
      }, MOVIES_POST_RESTORE_LATCH_MS);
    },
    [releasePostRestoreLatch],
  );

  const releaseFocusSuppressionAfterStabilize = useCallback((token: string | null) => {
    if (suppressionReleaseTimerRef.current) {
      clearTimeout(suppressionReleaseTimerRef.current);
      suppressionReleaseTimerRef.current = null;
    }
    setFocusSuppressionHeld(true);
    const latchActive = isMoviesPostRestoreLatchActive(postRestoreLatchRef.current);
    // Stage 3D.3: Search/navbar/category stay non-focusable while latch owns focus.
    logMoviesFocusSuppression({
      token,
      phase: 'browse-restored',
      searchAllowed: !latchActive,
      navbarAllowed: !latchActive,
      categoryAllowed: !latchActive,
      firstPosterAllowed: false,
    });
    requestAnimationFrame(() => {
      suppressionReleaseTimerRef.current = setTimeout(() => {
        suppressionReleaseTimerRef.current = null;
        setFocusSuppressionHeld(false);
        setDetailFocusPhaseSafe('browse');
        restoreScrollBlockedRef.current = false;
        scrollIssuedTokenRef.current = null;
        setViewportRestoreCommand(null);
        const latchStillActive = isMoviesPostRestoreLatchActive(postRestoreLatchRef.current);
        logMoviesFocusSuppression({
          token,
          phase: 'browse',
          searchAllowed: !latchStillActive,
          navbarAllowed: !latchStillActive,
          categoryAllowed: !latchStillActive,
          firstPosterAllowed: !latchStillActive,
        });
        if (latchStillActive) {
          logMoviesPostRestoreFocus({
            token: postRestoreLatchRef.current?.token ?? token,
            restoredMovieId: postRestoreLatchRef.current?.restoredMovieId ?? null,
            phase: 'browse',
            postRestoreActive: true,
            searchPreferred: false,
            navbarPreferred: false,
            categoryPreferred: false,
            firstPosterPreferred: false,
            actualFocusedComponent: actualFocusedComponentRef.current,
            releaseReason: null,
          });
        }
      }, MOVIES_FOCUS_SUPPRESSION_RELEASE_MS);
    });
  }, [setDetailFocusPhaseSafe]);

  useEffect(() => {
    detailOpenRef.current = detailOpen;
    setMoviesDetailOpenForDiagnostics(detailOpen || detailClosing);
  }, [detailClosing, detailOpen]);

  // Audit-only: keep grid unmount / gate inference in sync with screen state.
  useEffect(() => {
    if (!isOnnMoviesTraceEnabled()) {
      return;
    }
    setMoviesOnnTraceSnapshot({
      providerId: activeProviderId,
      route: 'movies',
      selectedCategoryId,
      selectedMovieId: selectedMovie?.id ?? null,
      focusedMovieId: getFocusedMovieId(),
      detailOpen: detailOpen || detailClosing,
      detailFocusPhase,
      searchPhase,
      playbackActive,
      playbackClosing,
      restoringBrowseFocus,
      categoriesLength: categories.length,
      visibleMoviesLength: visibleMovies.length,
      loadStatus,
      readableGeneration: null,
      syncingGeneration: null,
      activeProviderGeneration: null,
      catalogRepairing,
    });
  }, [
    activeProviderId,
    catalogRepairing,
    categories.length,
    detailClosing,
    detailFocusPhase,
    detailOpen,
    getFocusedMovieId,
    loadStatus,
    playbackActive,
    playbackClosing,
    restoringBrowseFocus,
    searchPhase,
    selectedCategoryId,
    selectedMovie?.id,
    visibleMovies.length,
  ]);

  useEffect(() => {
    if (!isOnnMoviesTraceEnabled()) {
      return;
    }
    const nextGate = categories.length > 0;
    const previousGate = gridGateOpenRef.current;
    if (previousGate === nextGate) {
      return;
    }
    gridGateOpenRef.current = nextGate;
    if (previousGate == null) {
      return;
    }
    const reason = !nextGate
      ? catalogRepairing
        ? 'categories-empty-repairing'
        : loadStatus === 'loading'
          ? 'categories-empty-loading'
          : 'categories-empty'
      : loadStatus === 'ready'
        ? 'categories-ready'
        : 'categories-nonempty';
    traceOnnMoviesEvent('Render', 'movie_grid_gate_changed', {
      previousGate,
      nextGate,
      categoriesLength: categories.length,
      visibleMoviesLength: visibleMovies.length,
      loadStatus,
      catalogRepairing,
      reason,
      detailOpen: detailOpen || detailClosing,
      gridInstanceId: getOnnMoviesGridInstanceId(),
    });
    captureOnnMoviesScreenState({
      providerId: activeProviderId,
      route: 'movies',
      selectedCategoryId,
      selectedMovieId: selectedMovie?.id ?? null,
      focusedMovieId: getFocusedMovieId(),
      detailOpen: detailOpen || detailClosing,
      detailFocusPhase,
      searchPhase,
      playbackActive,
      playbackClosing,
      restoringBrowseFocus,
      categoriesLength: categories.length,
      visibleMoviesLength: visibleMovies.length,
      loadStatus,
      catalogRepairing,
      gridGate: nextGate,
    });
  }, [
    activeProviderId,
    catalogRepairing,
    categories.length,
    detailClosing,
    detailFocusPhase,
    detailOpen,
    getFocusedMovieId,
    loadStatus,
    playbackActive,
    playbackClosing,
    restoringBrowseFocus,
    searchPhase,
    selectedCategoryId,
    selectedMovie?.id,
    visibleMovies.length,
  ]);

  useEffect(() => {
    tvPerfSetScreen('movies');
  }, []);

  // Audit-only: env-driven ONN auto trace (no console / DevTools required).
  useEffect(() => {
    maybeBeginOnnMoviesAutoTrace({
      source: 'MoviesScreen',
      subscribeAppState: (handler) => {
        const subscription = AppState.addEventListener('change', handler);
        return () => subscription.remove();
      },
    });
  }, []);

  // Stage 3D.2: directional input releases preferred ownership (not focusability).
  const reactNativeTv = ReactNative as typeof ReactNative & {
    useTVEventHandler?: (handler: (event: MoviesTvEventPayload) => void) => void;
  };
  const useTVEventHandler = reactNativeTv.useTVEventHandler ?? noopUseMoviesTvEventHandler;
  useTVEventHandler((event: MoviesTvEventPayload) => {
    if (!postRestoreLatchRef.current?.postRestoreActive) {
      return;
    }
    const eventType = event.eventType;
    if (eventType === 'up' || eventType === 'down' || eventType === 'left' || eventType === 'right') {
      releasePostRestoreLatch('dpad-input');
    }
  });

  useEffect(() => {
    return () => {
      if (suppressionReleaseTimerRef.current) {
        clearTimeout(suppressionReleaseTimerRef.current);
        suppressionReleaseTimerRef.current = null;
      }
      if (postRestoreTimeoutRef.current) {
        clearTimeout(postRestoreTimeoutRef.current);
        postRestoreTimeoutRef.current = null;
      }
      const latch = postRestoreLatchRef.current;
      if (latch?.postRestoreActive) {
        postRestoreLatchRef.current = { ...latch, postRestoreActive: false };
        logMoviesPostRestoreFocus({
          token: latch.token,
          restoredMovieId: latch.restoredMovieId,
          phase: detailFocusPhaseRef.current,
          postRestoreActive: false,
          searchPreferred: false,
          navbarPreferred: false,
          categoryPreferred: false,
          firstPosterPreferred: false,
          actualFocusedComponent: actualFocusedComponentRef.current,
          releaseReason: 'unmount',
        });
      }
    };
  }, []);

  useEffect(() => {
    console.info(
      '[NovaCast Movies Detail/List Audit] ' +
        JSON.stringify({
          action: previousMoviesDataRef.current === visibleMovies ? 'render-audit' : 'data-array-replaced',
          detailOpen,
          selectedMovieId: moviesAuditRef.current.selectedMovieId,
          focusedMovieId: moviesAuditRef.current.focusedMovieId,
          visibleMoviesLength: visibleMovies.length,
          currentOffset: viewportStateRef.current.offset,
          categoryId: selectedCategoryId,
          firstMovieId: visibleMovies[0]?.id ?? null,
          dataArrayChanged: previousMoviesDataRef.current !== visibleMovies,
        }),
    );
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

  const completeDetailFocusRestore = useCallback(
    (movieId: string, highlightVisible: boolean) => {
      const token = detailFocusTokenRef.current;
      const snapshot = token?.snapshot ?? browseFocusSnapshotRef.current;
      if (!token || !snapshot) {
        return false;
      }

      const targetMovieId = closingFocusMovieId ?? snapshot.movieId;
      const movieIndex =
        snapshot.movieId === movieId
          ? snapshot.movieIndex
          : Math.max(0, visibleMovies.findIndex((item) => item.id === movieId));
      const snapshotWasVisible = wasMoviesSnapshotTargetVisible(snapshot);
      const currentOffset = viewportStateRef.current.offset;
      const offsetDelta = currentOffset - snapshot.verticalOffset;
      const viewportStable = isMoviesViewportOffsetStable({
        currentOffset,
        snapshotOffset: snapshot.verticalOffset,
      });
      viewportStableRef.current = viewportStable;
      targetFocusConfirmedRef.current = highlightVisible && movieId === targetMovieId;

      // Do not complete on focus alone — native TV auto-scroll may have drifted.
      if (targetFocusConfirmedRef.current && !viewportStable) {
        const rowDrift = isMoviesNativeFocusRowAlignmentDrift({ offsetDelta });
        const returnPath = detailReturnPathRef.current;
        const maxRestores = resolveMoviesDetailReturnMaxViewportRestores(returnPath);
        logMoviesViewportLock({
          token: token.token,
          phase: detailFocusPhaseRef.current,
          targetMovieId,
          targetIndex: movieIndex,
          snapshotOffset: snapshot.verticalOffset,
          currentOffset,
          offsetDelta,
          targetRelativeRow: snapshot.targetRelativeRow,
          snapshotTargetWasVisible: snapshotWasVisible,
          initialRestoreIssued: viewportRestoreCountRef.current >= 1 && !isMoviesDetailReturnFastPath(returnPath),
          correctiveRestoreIssued: viewportRestoreCountRef.current >= maxRestores,
          focusRequestCount: focusRequestCountRef.current,
          targetFocusConfirmed: true,
          highlightVisible,
          viewportStable: false,
          overlayMounted: true,
        });
        if (isOnnMoviesTraceEnabled()) {
          traceOnnMoviesEvent('Scroll', 'native_focus_drift_detected', {
            token: token.token,
            snapshotOffset: snapshot.verticalOffset,
            focusedOffset: currentOffset,
            delta: offsetDelta,
            returnPath,
            rowDrift,
            marker: MOVIES_FOCUS_STAGE4F_MARKER,
          });
        }
        if (viewportRestoreCountRef.current < maxRestores) {
          viewportRestoreCountRef.current += 1;
          if (restoreTimingRef.current) {
            restoreTimingRef.current.correctiveScrollUsed = true;
          }
          setLockScrollForFocusRestore(true);
          setViewportRestoreCommand({
            token: `${token.token}:corrective`,
            offset: snapshot.verticalOffset,
            reason: 'corrective',
          });
          if (isOnnMoviesTraceEnabled()) {
            traceOnnMoviesEvent('Scroll', 'covered_corrective_scroll', {
              token: token.token,
              requestedOffset: snapshot.verticalOffset,
              currentOffset,
              delta: snapshot.verticalOffset - currentOffset,
              returnPath,
              overlayMounted: true,
              marker: MOVIES_FOCUS_STAGE4F_MARKER,
            });
          }
          // Stage 3D.3: keep highlight via pinned chrome; do not re-request poster focus.
          if (shouldReRequestMoviesPosterFocusAfterCorrective({ targetFocusConfirmed: true })) {
            focusIssuedTokenRef.current = null;
          }
          if (rowDrift) {
            console.info(
              '[NovaCast Movies Viewport Lock] ' +
                JSON.stringify({
                  token: token.token,
                  phase: detailFocusPhaseRef.current,
                  note: 'native-focus-row-alignment-corrective',
                  offsetDelta,
                  returnPath,
                  marker: MOVIES_FOCUS_STAGE4F_MARKER,
                }),
            );
          }
          setRestorationRetry((value) => value + 1);
        }
        return false;
      }

      const confirmed = isMoviesDetailFocusConfirmed({
        actuallyFocusedMovieId: movieId,
        targetMovieId,
        targetIndex: movieIndex,
        visibleFirstIndex: snapshotWasVisible
          ? snapshot.visibleFirstIndex
          : viewportStateRef.current.firstIndex,
        visibleLastIndex: snapshotWasVisible
          ? snapshot.visibleLastIndex
          : viewportStateRef.current.lastIndex,
        highlightVisible,
        currentOffset,
        snapshotOffset: snapshot.verticalOffset,
        snapshotTargetWasVisible: snapshotWasVisible,
      });

      logMoviesDetailFocusLifecycle({
        token: token.token,
        phase: 'closing-confirm',
        targetMovieId,
        targetIndex: movieIndex,
        targetVisible: snapshotWasVisible,
        currentOffset,
        scrollIssued: scrollIssuedTokenRef.current === token.token,
        focusIssued: focusIssuedTokenRef.current === token.token,
        actuallyFocusedMovieId: movieId,
        highlightVisible,
        overlayMounted: true,
      });
      logMoviesViewportLock({
        token: token.token,
        phase: 'closing-confirm',
        targetMovieId,
        targetIndex: movieIndex,
        snapshotOffset: snapshot.verticalOffset,
        currentOffset,
        offsetDelta,
        targetRelativeRow: snapshot.targetRelativeRow,
        snapshotTargetWasVisible: snapshotWasVisible,
        initialRestoreIssued: viewportRestoreCountRef.current >= 1,
        correctiveRestoreIssued: viewportRestoreCountRef.current >= 2,
        focusRequestCount: focusRequestCountRef.current,
        targetFocusConfirmed: targetFocusConfirmedRef.current,
        highlightVisible,
        viewportStable,
        overlayMounted: true,
      });

      if (!confirmed) {
        return false;
      }

      if (confirmTimeoutRef.current) {
        clearTimeout(confirmTimeoutRef.current);
        confirmTimeoutRef.current = null;
      }

      restoreScrollBlockedRef.current = true;
      setLockScrollForFocusRestore(false);
      setDetailFocusPhaseSafe('closing-confirm');
      detailFocusTokenRef.current = null;
      focusIssuedTokenRef.current = null;
      isRestoringPlaybackFocusRef.current = false;
      setRestoringBrowseFocus(false);
      // Keep closingFocusMovieId until latch owns preferred/highlight pin.
      browseFocusSnapshotRef.current = createMoviesBrowseFocusSnapshot({
        ...snapshot,
        movieId,
        movieIndex,
        columns: getSeriesPosterColumns(width),
      });

      // Hide overlay only after focus + viewport both confirm (Stage 4.2F reveal).
      setDetailOpen(false);
      detailOpenRef.current = false;
      setDetailSuppressedForPlayback(false);
      setDetailFocusPhaseSafe('browse-restored');
      setViewportRestoreCommand(null);
      const overlayRemovedAt = Date.now();
      if (restoreTimingRef.current && restoreTimingRef.current.token === token.token) {
        restoreTimingRef.current.overlayRemovedAt = overlayRemovedAt;
        if (restoreTimingRef.current.focusConfirmedAt == null) {
          restoreTimingRef.current.focusConfirmedAt = overlayRemovedAt;
        }
        logMoviesRestoreTiming({
          token: token.token,
          startedAt: restoreTimingRef.current.startedAt,
          viewportConfirmedAt: restoreTimingRef.current.viewportConfirmedAt,
          focusConfirmedAt: restoreTimingRef.current.focusConfirmedAt,
          overlayRemovedAt,
          totalMs: overlayRemovedAt - restoreTimingRef.current.startedAt,
          correctiveScrollUsed: restoreTimingRef.current.correctiveScrollUsed,
          searchFocusAttempted: restoreTimingRef.current.searchFocusAttempted,
        });
      }
      logMoviesDetailFocusLifecycle({
        token: token.token,
        phase: 'browse-restored',
        targetMovieId: movieId,
        targetIndex: movieIndex,
        targetVisible: true,
        currentOffset,
        scrollIssued: scrollIssuedTokenRef.current === token.token,
        focusIssued: true,
        actuallyFocusedMovieId: movieId,
        highlightVisible: true,
        overlayMounted: false,
      });
      if (isOnnMoviesTraceEnabled()) {
        const returnPath = detailReturnPathRef.current;
        const correctionCount = viewportRestoreCountRef.current;
        traceOnnMoviesEvent('Focus', 'focus_confirmed', {
          movieId,
          offset: currentOffset,
          gridInstanceId: getOnnMoviesGridInstanceId(),
          returnPath,
        });
        traceOnnMoviesScrollSample('post-poster-focus', { offset: currentOffset }, true);
        traceOnnMoviesEvent('Overlay', 'browse_reveal', {
          finalOffset: currentOffset,
          focusConfirmed: true,
          correctionCount,
          userVisibleMovementExpected: false,
          returnPath,
          marker: MOVIES_FOCUS_STAGE4F_MARKER,
        });
        traceOnnMoviesEvent('Overlay', 'browse_restored', {
          movieId,
          offset: currentOffset,
          gridInstanceId: getOnnMoviesGridInstanceId(),
          returnPath,
        });
        traceOnnMoviesEvent('Overlay', 'overlay_unmounted', {
          movieId,
          offset: currentOffset,
        });
        traceOnnMoviesScrollSample('post-restore-latch', { offset: currentOffset }, true);
      }
      detailReturnPathRef.current = null;
      console.info(
        '[NovaCast Movies Restore Polish] ' +
          JSON.stringify({ marker: MOVIES_FOCUS_STAGE3D3_MARKER, token: token.token }),
      );
      // Stage 3D.2/3D.3: pin preferred ownership — do not re-request focus.
      activatePostRestoreLatch(token.token, movieId);
      releaseFocusSuppressionAfterStabilize(token.token);
      // Clear target-only focus gate after latch owns highlight pin.
      setTimeout(() => {
        setClosingFocusMovieId(null);
      }, MOVIES_FOCUS_SUPPRESSION_RELEASE_MS + 16);
      return true;
    },
    [
      activatePostRestoreLatch,
      closingFocusMovieId,
      releaseFocusSuppressionAfterStabilize,
      setDetailFocusPhaseSafe,
      visibleMovies,
      width,
    ],
  );

  const handleFocusMovie = useCallback(
    (movie: { id: string }) => {
      if (playbackUiActive || Date.now() < playFocusGuardUntilRef.current) {
        return;
      }
      if (isOnnMoviesTraceEnabled()) {
        const targetId =
          closingFocusMovieId ?? detailFocusTokenRef.current?.snapshot.movieId ?? null;
        traceOnnMoviesEvent('Focus', 'poster_focus', {
          movieId: movie.id,
          offsetAtFocus: viewportStateRef.current.offset,
          firstVisibleIndex: viewportStateRef.current.firstIndex,
          lastVisibleIndex: viewportStateRef.current.lastIndex,
          detailPhase: detailFocusPhaseRef.current,
          matchesRequestedTarget: targetId == null ? null : movie.id === targetId,
          requestedTargetMovieId: targetId,
          gridInstanceId: getOnnMoviesGridInstanceId(),
        });
      }
      tvPerfSetFocus('MoviePosterCard', movie.id);
      actualFocusedComponentRef.current = 'MoviePosterCard';

      const phase = detailFocusPhaseRef.current;
      if (isMoviesDetailClosingPhase(phase)) {
        const targetId = closingFocusMovieId ?? detailFocusTokenRef.current?.snapshot.movieId ?? null;
        if (targetId && movie.id !== targetId) {
          logMoviesDetailFocusConflict({
            token: detailFocusTokenRef.current?.token ?? null,
            phase,
            winningComponent: 'MoviePosterCard',
            targetMovieId: targetId,
            actuallyFocusedMovieId: movie.id,
            reason: 'non-target-poster-during-close',
          });
          focusIssuedTokenRef.current = null;
          setRestorationRetry((value) => value + 1);
          return;
        }
        if (restoreTimingRef.current && restoreTimingRef.current.focusConfirmedAt == null) {
          restoreTimingRef.current.focusConfirmedAt = Date.now();
        }
        focusMovie(movie as Parameters<typeof focusMovie>[0]);
        completeDetailFocusRestore(movie.id, true);
        return;
      }

      const latch = postRestoreLatchRef.current;
      if (latch?.postRestoreActive && movie.id !== latch.restoredMovieId) {
        releasePostRestoreLatch('focus-left-poster');
      }

      if (!isMoviesBrowseSnapshotImmutable(phase)) {
        browseFocusSnapshotRef.current = createMoviesBrowseFocusSnapshot({
          categoryId: selectedCategoryId,
          movieId: movie.id,
          movieIndex: Math.max(0, visibleMovies.findIndex((item) => item.id === movie.id)),
          verticalOffset: viewportStateRef.current.offset,
          visibleFirstIndex: viewportStateRef.current.firstIndex,
          visibleLastIndex: viewportStateRef.current.lastIndex,
          columns: getSeriesPosterColumns(width),
        });
      }
      focusMovie(movie as Parameters<typeof focusMovie>[0]);
    },
    [
      closingFocusMovieId,
      completeDetailFocusRestore,
      focusMovie,
      playbackUiActive,
      releasePostRestoreLatch,
      selectedCategoryId,
      visibleMovies,
      width,
    ],
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

      // Immutable snapshot taken immediately before opening detail.
      browseFocusSnapshotRef.current = createMoviesBrowseFocusSnapshot({
        categoryId: selectedCategoryId,
        movieId: movie.id,
        movieIndex: Math.max(0, visibleMovies.findIndex((item) => item.id === movie.id)),
        verticalOffset: viewportStateRef.current.offset,
        visibleFirstIndex: viewportStateRef.current.firstIndex,
        visibleLastIndex: viewportStateRef.current.lastIndex,
        columns: getSeriesPosterColumns(width),
      });
      detailOpenContextRef.current = {
        providerId: activeProviderId,
        readableGeneration: getMoviesOnnTraceSnapshot().readableGeneration,
        gridInstanceId: getOnnMoviesGridInstanceId(),
      };
      setDetailSource('browse');
      detailSourceRef.current = 'browse';
      selectMovie(movie);
      detailOpenRef.current = true;
      const detailPromise = loadMovieDetail(movie, { origin: 'browse' });
      pendingDetailPromiseRef.current = detailPromise;
      detailPromise.finally(() => {
        if (pendingDetailPromiseRef.current === detailPromise) {
          pendingDetailPromiseRef.current = null;
        }
      });
      setDetailSuppressedForPlayback(false);
      releasePostRestoreLatch('screen-change');
      setDetailOpen(true);
      setDetailFocusPhaseSafe('detail-open');
      if (isOnnMoviesTraceEnabled()) {
        const snap = browseFocusSnapshotRef.current;
        traceOnnMoviesEvent('Overlay', 'detail_open', {
          movieId: movie.id,
          categoryId: selectedCategoryId,
          renderedIndex: snap?.movieIndex ?? null,
          listOffset: snap?.verticalOffset ?? viewportStateRef.current.offset,
          firstVisibleIndex: snap?.firstVisibleIndex ?? null,
          lastVisibleIndex: snap?.lastVisibleIndex ?? null,
          gridInstanceId: getOnnMoviesGridInstanceId(),
          gridMounted: isOnnMoviesGridMounted(),
          categoriesLength: categories.length,
          visibleMoviesLength: visibleMovies.length,
          loadStatus,
        });
      }
      // Diagnostics-only shape snapshot at browse Detail open.
      logMoviePlaybackShape({
        origin: 'browse-detail',
        movieId: movie.id,
        contentId: movie.id,
        streamId: movie.id,
        providerId: activeProviderId,
        mediaType: 'movie',
        containerExtension: movie.containerExtension,
        title: movie.title,
        posterUrl: movie.posterUrl,
      });
      logMoviesDetailFocusLifecycle({
        token: null,
        phase: 'detail-open',
        targetMovieId: movie.id,
        targetIndex: browseFocusSnapshotRef.current.movieIndex,
        targetVisible: true,
        currentOffset: viewportStateRef.current.offset,
        scrollIssued: false,
        focusIssued: false,
        actuallyFocusedMovieId: movie.id,
        highlightVisible: true,
        overlayMounted: true,
      });
    },
    [
      activeProviderId,
      detailOpen,
      launchingPlayback,
      loadMovieDetail,
      playbackUiActive,
      releasePostRestoreLatch,
      selectMovie,
      selectedCategoryId,
      selectedMovie?.id,
      setDetailFocusPhaseSafe,
      visibleMovies,
      width,
    ],
  );

  const handleViewportChange = useCallback(
    (state: { offset: number; firstIndex: number | null; lastIndex: number | null }) => {
      viewportStateRef.current = state;
      const phase = detailFocusPhaseRef.current;
      const token = detailFocusTokenRef.current;
      if ((phase === 'closing-viewport' || phase === 'closing-focus') && token) {
        const stable = isMoviesViewportOffsetStable({
          currentOffset: state.offset,
          snapshotOffset: token.snapshot.verticalOffset,
          tolerancePx: MOVIES_VIEWPORT_OFFSET_TOLERANCE_PX,
        });
        if (stable) {
          // Kick the close driver to advance / re-confirm once offset matches snapshot.
          setRestorationRetry((value) => value + 1);
        } else if (phase === 'closing-focus' && targetFocusConfirmedRef.current) {
          // Native focus auto-scroll drifted after poster focus — re-enter confirm/corrective.
          setRestorationRetry((value) => value + 1);
        }
      }
      // Snapshot is immutable while detail is open or closing — never mutate it here.
      if (isMoviesBrowseSnapshotImmutable(phase)) {
        return;
      }
      const snapshot = browseFocusSnapshotRef.current;
      if (snapshot) {
        browseFocusSnapshotRef.current = createMoviesBrowseFocusSnapshot({
          categoryId: snapshot.categoryId,
          movieId: snapshot.movieId,
          movieIndex: snapshot.movieIndex,
          verticalOffset: state.offset,
          visibleFirstIndex: state.firstIndex,
          visibleLastIndex: state.lastIndex,
          columns: getSeriesPosterColumns(width),
        });
      }
    },
    [width],
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
    searchPhaseRef.current = searchPhase;
  }, [searchPhase]);

  useEffect(() => {
    detailSourceRef.current = detailSource;
  }, [detailSource]);

  useEffect(() => {
    if (!searchOverlayVisible || playbackUiActive) {
      setSearchOverlayReady(false);
    }
  }, [playbackUiActive, searchOverlayVisible]);

  // Diagnostics-only controlled search probe (no keyboard automation).
  // Runs once when Movies is ready so ONN timings are captured without typing.
  useEffect(() => {
    if (playbackUiActive || !activeProviderId) {
      return;
    }
    void (async () => {
      const selection = await resolveMoviesSearchDatasource({
        providerId: activeProviderId,
        browseDataSource:
          process.env.EXPO_PUBLIC_MOVIES_SQLITE_READS === 'true'
            ? createSqliteMovieDataSource(activeProviderId)
            : null,
        bundleMovies: bundle?.movies,
      });
      await runMoviesSearchPerfProbeOnce({
        providerId: activeProviderId,
        dataSource: selection.dataSource,
      });
    })();
  }, [activeProviderId, bundle?.movies, playbackUiActive]);

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
  // Presentation-only: All Movies stays in `categories` for fallback/queries.
  const railCategories = useMemo(() => {
    if (visibleMovieCategories.some((category) => category.kind !== 'section')) {
      return visibleMovieCategories;
    }
    return getMovieCategoryRailCategories(categories);
  }, [categories, visibleMovieCategories]);
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
    logMoviesSearchSelection({
      requestId: getActiveMoviesSearchRequestId(),
      query: searchQueryForSelectionRef.current,
      movieId: searchRestoreMovieId,
      action: 'search-reset',
      searchPhase: 'closed',
      detailSource: detailSourceRef.current,
      searchOpen: false,
      detailOpen: detailOpenRef.current,
      selectedMovieStored: Boolean(selectedMovie?.id),
      overlayVisible: false,
    });
    setSearchPhase('closed');
    setSearchOverlayReady(false);
    setSearchRestoreMovieId(null);
    focusSelectedPoster('restore-after-search-close');
  }, [focusSelectedPoster, searchRestoreMovieId, selectedMovie?.id]);

  const beginDetailFocusClose = useCallback(
    (source: 'detail-close' | 'playback-close') => {
      const snapshot = browseFocusSnapshotRef.current;
      if (!snapshot || snapshot.categoryId !== selectedCategoryId || !snapshot.movieId) {
        logMoviesDetailFocusConflict({
          token: null,
          phase: detailFocusPhaseRef.current,
          winningComponent: 'MoviesScreen',
          targetMovieId: snapshot?.movieId ?? null,
          actuallyFocusedMovieId: null,
          reason: 'missing-immutable-snapshot',
        });
        return false;
      }

      const token = `${source === 'detail-close' ? 'detail' : 'playback'}-${++restorationSequenceRef.current}`;
      const openContext = detailOpenContextRef.current;
      const targetNativeHandleExists = Boolean(
        getValidatedPosterTarget(snapshot.movieId, snapshot.movieIndex >= 0 ? snapshot.movieIndex : undefined),
      );
      const returnPath = selectMoviesDetailReturnPath({
        hasSnapshot: true,
        snapshotCategoryId: snapshot.categoryId,
        selectedCategoryId,
        openProviderId: openContext?.providerId ?? null,
        activeProviderId,
        openReadableGeneration: openContext?.readableGeneration ?? null,
        activeReadableGeneration: getMoviesOnnTraceSnapshot().readableGeneration,
        openGridInstanceId: openContext?.gridInstanceId ?? null,
        activeGridInstanceId: getOnnMoviesGridInstanceId(),
        targetMovieId: snapshot.movieId,
        targetInVisibleMovies: visibleMovies.some((movie) => movie.id === snapshot.movieId),
        targetNativeHandleExists,
      });
      detailReturnPathRef.current = returnPath;
      if (isOnnMoviesTraceEnabled()) {
        traceOnnMoviesEvent('Focus', 'detail_close_requested', {
          source,
          closeSource: detailCloseSourceRef.current,
          token,
          movieId: snapshot.movieId,
          categoryId: snapshot.categoryId,
          renderedIndex: snapshot.movieIndex,
          listOffset: snapshot.verticalOffset,
          firstVisibleIndex: snapshot.firstVisibleIndex,
          lastVisibleIndex: snapshot.lastVisibleIndex,
          gridInstanceId: getOnnMoviesGridInstanceId(),
          gridMounted: isOnnMoviesGridMounted(),
          currentOffset: viewportStateRef.current.offset,
          returnPath,
        });
        traceOnnMoviesEvent('Focus', 'detail_return_path_selected', {
          path: returnPath,
          token,
          movieId: snapshot.movieId,
          categoryId: snapshot.categoryId,
          gridInstanceId: getOnnMoviesGridInstanceId(),
          targetNativeHandleExists,
          marker: MOVIES_FOCUS_STAGE4F_MARKER,
        });
      }
      detailFocusTokenRef.current = { token, source, snapshot };
      focusIssuedTokenRef.current = null;
      scrollIssuedTokenRef.current = null;
      restoreScrollBlockedRef.current = false;
      viewportRestoreCountRef.current = 0;
      focusRequestCountRef.current = 0;
      targetFocusConfirmedRef.current = false;
      viewportStableRef.current = false;
      restoreTimingRef.current = createMoviesRestoreTiming(token);
      setLockScrollForFocusRestore(false);
      setViewportRestoreCommand(null);
      setFocusSuppressionHeld(true);
      setClosingFocusMovieId(snapshot.movieId);
      setRestoringBrowseFocus(true);
      setDetailFocusPhaseSafe('closing-prepare');
      const snapshotWasVisible = wasMoviesSnapshotTargetVisible(snapshot);
      logMoviesDetailFocusLifecycle({
        token,
        phase: 'closing-prepare',
        targetMovieId: snapshot.movieId,
        targetIndex: snapshot.movieIndex,
        targetVisible: snapshotWasVisible,
        currentOffset: viewportStateRef.current.offset,
        scrollIssued: false,
        focusIssued: false,
        actuallyFocusedMovieId: null,
        highlightVisible: false,
        overlayMounted: true,
      });
      logMoviesFocusSuppression({
        token,
        phase: 'closing-prepare',
        searchAllowed: false,
        navbarAllowed: false,
        categoryAllowed: false,
        firstPosterAllowed: false,
      });
      console.info('[NovaCast Movies Focus Handoff]', {
        marker: MOVIES_FOCUS_STAGE4F_MARKER,
        stage3d1Marker: MOVIES_FOCUS_STAGE3D1_MARKER,
        categoryId: selectedCategoryId,
        phase: 'closing-prepare',
        intendedMovieId: snapshot.movieId,
        returnPath,
        focusRequested: true,
        detailOpened: true,
      });

      if (confirmTimeoutRef.current) {
        clearTimeout(confirmTimeoutRef.current);
      }
      confirmTimeoutRef.current = setTimeout(() => {
        if (!isMoviesDetailClosingPhase(detailFocusPhaseRef.current)) {
          return;
        }
        const nearest = resolveNearestVisiblePoster({
          targetIndex: snapshot.movieIndex,
          visibleFirstIndex: viewportStateRef.current.firstIndex,
          visibleLastIndex: viewportStateRef.current.lastIndex,
          movies: visibleMovies,
        });
        logMoviesDetailFocusConflict({
          token,
          phase: detailFocusPhaseRef.current,
          winningComponent: 'MoviesScreen',
          targetMovieId: snapshot.movieId,
          actuallyFocusedMovieId: nearest?.movieId ?? null,
          reason: nearest
            ? 'timeout-nearest-visible-fallback'
            : 'timeout-no-visible-fallback',
        });
        if (nearest) {
          setClosingFocusMovieId(nearest.movieId);
          focusIssuedTokenRef.current = null;
          setRestorationRetry((value) => value + 1);
        }
      }, MOVIES_DETAIL_FOCUS_CONFIRM_TIMEOUT_MS);

      return true;
    },
    [
      activeProviderId,
      getValidatedPosterTarget,
      selectedCategoryId,
      setDetailFocusPhaseSafe,
      visibleMovies,
    ],
  );

  const closeDetail = useCallback((closeSource: 'back' | 'x' | 'other' = 'other') => {
    detailCloseSourceRef.current = closeSource;
    if (!canBeginMoviesDetailClose(detailFocusPhaseRef.current)) {
      // One close transition only — swallow duplicate Back during closing.
      return;
    }

    // Stage 3G.3: Search-origin detail closes back into Search — skip browse restore.
    if (detailSourceRef.current === 'search') {
      const movieId = selectedMovie?.id ?? searchRestoreMovieId;
      logMoviesSearchSelection({
        requestId: getActiveMoviesSearchRequestId(),
        query: searchQueryForSelectionRef.current,
        movieId,
        action: 'detail-closed',
        searchPhase: 'returning',
        detailSource: 'search',
        searchOpen: true,
        detailOpen: false,
        selectedMovieStored: Boolean(movieId),
        overlayVisible: true,
      });
      setDetailOpen(false);
      detailOpenRef.current = false;
      setDetailSuppressedForPlayback(false);
      setDetailFocusPhaseSafe('browse');
      setClosingFocusMovieId(null);
      setRestoringBrowseFocus(false);
      setFocusSuppressionHeld(false);
      setSearchRestoreMovieId(movieId);
      setSearchOverlayReady(true);
      setSearchPhase('returning');
      searchPhaseRef.current = 'returning';
      logMoviesSearchSelection({
        requestId: getActiveMoviesSearchRequestId(),
        query: searchQueryForSelectionRef.current,
        movieId,
        action: 'search-restoring',
        searchPhase: 'returning',
        detailSource: 'search',
        searchOpen: true,
        detailOpen: false,
        selectedMovieStored: Boolean(movieId),
        overlayVisible: true,
      });
      return;
    }

    beginFocusAuditCycle('movies-detail-close', {
      categoryId: selectedCategoryId,
      movieId: browseFocusSnapshotRef.current?.movieId ?? null,
    });
    // Keep overlay mounted (detailOpen stays true) until exact poster confirm.
    if (!beginDetailFocusClose('detail-close')) {
      setDetailOpen(false);
      detailOpenRef.current = false;
      setDetailSuppressedForPlayback(false);
      setDetailFocusPhaseSafe('browse');
      focusSelectedPoster('restore-after-detail-close');
    }
  }, [
    beginDetailFocusClose,
    focusSelectedPoster,
    searchRestoreMovieId,
    selectedCategoryId,
    selectedMovie?.id,
    setDetailFocusPhaseSafe,
  ]);

  // Stage 3D.1: prepare → viewport lock → focus → confirm (focus + offset).
  useEffect(() => {
    const token = detailFocusTokenRef.current;
    const phase = detailFocusPhaseRef.current;
    if (!token || !isMoviesDetailClosingPhase(phase)) {
      return;
    }

    const snapshot = token.snapshot;
    const targetMovieId = closingFocusMovieId ?? snapshot.movieId;
    const targetIndex =
      targetMovieId === snapshot.movieId
        ? snapshot.movieIndex
        : Math.max(0, visibleMovies.findIndex((movie) => movie.id === targetMovieId));
    const targetInPage = visibleMovies.some((movie) => movie.id === targetMovieId);
    // Snapshot visibility is authoritative while overlay owns focus.
    const snapshotWasVisible = wasMoviesSnapshotTargetVisible(snapshot);
    const currentOffset = viewportStateRef.current.offset;
    const offsetDelta = currentOffset - snapshot.verticalOffset;
    const viewportStable = isMoviesViewportOffsetStable({
      currentOffset,
      snapshotOffset: snapshot.verticalOffset,
    });

    if (phase === 'closing-prepare') {
      requestAnimationFrame(() => {
        overlayCloseTargetRef.current?.focus();
        setDetailFocusPhaseSafe('closing-viewport');
        logMoviesDetailFocusLifecycle({
          token: token.token,
          phase: 'closing-viewport',
          targetMovieId,
          targetIndex,
          targetVisible: snapshotWasVisible,
          currentOffset,
          scrollIssued: false,
          focusIssued: false,
          actuallyFocusedMovieId: null,
          highlightVisible: false,
          overlayMounted: true,
        });
      });
      return;
    }

    if (phase === 'closing-viewport') {
      const returnPath = detailReturnPathRef.current;
      const fastPath = isMoviesDetailReturnFastPath(returnPath);

      // Stage 4.2F fast path: skip initial scrollToOffset. Grid stayed mounted at
      // the snapshot offset — focus under the covering overlay, then correct drift.
      if (fastPath) {
        viewportStableRef.current = true;
        requestAnimationFrame(() => {
          if (detailFocusTokenRef.current?.token !== token.token) {
            return;
          }
          if (detailFocusPhaseRef.current !== 'closing-viewport') {
            return;
          }
          if (restoreTimingRef.current?.token === token.token) {
            restoreTimingRef.current.viewportConfirmedAt = Date.now();
          }
          setDetailFocusPhaseSafe('closing-focus');
          logMoviesViewportLock({
            token: token.token,
            phase: 'closing-focus',
            targetMovieId,
            targetIndex,
            snapshotOffset: snapshot.verticalOffset,
            currentOffset: viewportStateRef.current.offset,
            offsetDelta: viewportStateRef.current.offset - snapshot.verticalOffset,
            targetRelativeRow: snapshot.targetRelativeRow,
            snapshotTargetWasVisible: snapshotWasVisible,
            initialRestoreIssued: false,
            correctiveRestoreIssued: false,
            focusRequestCount: focusRequestCountRef.current,
            targetFocusConfirmed: false,
            highlightVisible: false,
            viewportStable: true,
            overlayMounted: true,
          });
        });
        return;
      }

      // Fallback: restore saved offset once before focus (Stage 3D.1), but never
      // issue duplicate zero-delta initial commands when already on snapshot.
      if (
        viewportRestoreCountRef.current === 0 &&
        !restoreScrollBlockedRef.current &&
        Number.isFinite(snapshot.verticalOffset) &&
        shouldIssueMoviesInitialDetailRestore(returnPath)
      ) {
        if (
          shouldSkipZeroDeltaInitialRestore({
            reason: 'initial',
            requestedOffset: snapshot.verticalOffset,
            currentOffset,
          })
        ) {
          if (isOnnMoviesTraceEnabled()) {
            traceOnnMoviesEvent('Scroll', 'duplicate_initial_restore_prevented', {
              token: token.token,
              requestedOffset: snapshot.verticalOffset,
              currentOffset,
              delta: 0,
              returnPath,
            });
          }
          viewportStableRef.current = true;
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (detailFocusTokenRef.current?.token !== token.token) {
                return;
              }
              if (detailFocusPhaseRef.current !== 'closing-viewport') {
                return;
              }
              if (restoreTimingRef.current?.token === token.token) {
                restoreTimingRef.current.viewportConfirmedAt = Date.now();
              }
              setDetailFocusPhaseSafe('closing-focus');
            });
          });
          return;
        }

        viewportRestoreCountRef.current = 1;
        scrollIssuedTokenRef.current = token.token;
        setViewportRestoreCommand({
          token: token.token,
          offset: snapshot.verticalOffset,
          reason: 'initial',
        });
        logMoviesViewportLock({
          token: token.token,
          phase: 'closing-viewport',
          targetMovieId,
          targetIndex,
          snapshotOffset: snapshot.verticalOffset,
          currentOffset,
          offsetDelta,
          targetRelativeRow: snapshot.targetRelativeRow,
          snapshotTargetWasVisible: snapshotWasVisible,
          initialRestoreIssued: true,
          correctiveRestoreIssued: false,
          focusRequestCount: focusRequestCountRef.current,
          targetFocusConfirmed: false,
          highlightVisible: false,
          viewportStable,
          overlayMounted: true,
        });

        // Double-rAF settle gate: if FlatList suppresses a no-op onScroll,
        // still advance only after the restore command has been committed.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (detailFocusTokenRef.current?.token !== token.token) {
              return;
            }
            if (detailFocusPhaseRef.current !== 'closing-viewport') {
              return;
            }
            const settledOffset = viewportStateRef.current.offset;
            const settled = isMoviesViewportOffsetStable({
              currentOffset: settledOffset,
              snapshotOffset: snapshot.verticalOffset,
            });
            if (!settled) {
              // Wait for onScroll / corrective path to kick restorationRetry.
              setRestorationRetry((value) => value + 1);
              return;
            }
            viewportStableRef.current = true;
            if (restoreTimingRef.current?.token === token.token) {
              restoreTimingRef.current.viewportConfirmedAt = Date.now();
            }
            setDetailFocusPhaseSafe('closing-focus');
            logMoviesViewportLock({
              token: token.token,
              phase: 'closing-focus',
              targetMovieId,
              targetIndex,
              snapshotOffset: snapshot.verticalOffset,
              currentOffset: settledOffset,
              offsetDelta: settledOffset - snapshot.verticalOffset,
              targetRelativeRow: snapshot.targetRelativeRow,
              snapshotTargetWasVisible: snapshotWasVisible,
              initialRestoreIssued: true,
              correctiveRestoreIssued: false,
              focusRequestCount: focusRequestCountRef.current,
              targetFocusConfirmed: false,
              highlightVisible: false,
              viewportStable: true,
              overlayMounted: true,
            });
          });
        });
        return;
      }

      // Subsequent kicks (onScroll ack after restore / retry): advance only when stable.
      if (viewportRestoreCountRef.current > 0 && viewportStable) {
        viewportStableRef.current = true;
        requestAnimationFrame(() => {
          if (detailFocusTokenRef.current?.token !== token.token) {
            return;
          }
          if (detailFocusPhaseRef.current !== 'closing-viewport') {
            return;
          }
          if (restoreTimingRef.current?.token === token.token) {
            restoreTimingRef.current.viewportConfirmedAt = Date.now();
          }
          setDetailFocusPhaseSafe('closing-focus');
          logMoviesViewportLock({
            token: token.token,
            phase: 'closing-focus',
            targetMovieId,
            targetIndex,
            snapshotOffset: snapshot.verticalOffset,
            currentOffset: viewportStateRef.current.offset,
            offsetDelta: viewportStateRef.current.offset - snapshot.verticalOffset,
            targetRelativeRow: snapshot.targetRelativeRow,
            snapshotTargetWasVisible: snapshotWasVisible,
            initialRestoreIssued: true,
            correctiveRestoreIssued: viewportRestoreCountRef.current >= 2,
            focusRequestCount: focusRequestCountRef.current,
            targetFocusConfirmed: false,
            highlightVisible: false,
            viewportStable: true,
            overlayMounted: true,
          });
        });
      }
      return;
    }

    if (phase !== 'closing-focus') {
      return;
    }

    // Never transfer poster focus until the saved offset is stable.
    if (!viewportStable) {
      return;
    }

    // After a corrective offset restore, focus may already be on the target
    // without a new onFocus event — complete when both gates are true.
    if (targetFocusConfirmedRef.current && closingFocusMovieId) {
      completeDetailFocusRestore(closingFocusMovieId, true);
      return;
    }

    if (!targetInPage || focusIssuedTokenRef.current === token.token) {
      return;
    }
    if (focusRequestCountRef.current >= MOVIES_MAX_FOCUS_REQUESTS) {
      return;
    }

    focusIssuedTokenRef.current = token.token;
    focusRequestCountRef.current += 1;
    // Stage 3D.3: lock scroll before focus to prevent native one-row auto-align.
    setLockScrollForFocusRestore(true);

    const issueFocusRequest = () => {
      if (detailFocusTokenRef.current?.token !== token.token) {
        focusIssuedTokenRef.current = null;
        setLockScrollForFocusRestore(false);
        return;
      }
      if (isOnnMoviesTraceEnabled()) {
        traceOnnMoviesEvent('Focus', 'focus_request', {
          targetMovieId,
          requestReason:
            token.source === 'detail-close'
              ? 'restore-exact-poster-after-detail-close'
              : 'restore-after-playback-exact-poster',
          attemptNumber: focusRequestCountRef.current,
          detailPhase: detailFocusPhaseRef.current,
          gridOffset: viewportStateRef.current.offset,
          firstVisibleIndex: viewportStateRef.current.firstIndex,
          lastVisibleIndex: viewportStateRef.current.lastIndex,
          targetVisible: snapshotWasVisible,
          gridInstanceId: getOnnMoviesGridInstanceId(),
        });
        traceOnnMoviesScrollSample(
          'pre-poster-focus',
          { offset: viewportStateRef.current.offset },
          true,
        );
      }
      requestTvFocus({
        screen: 'movies',
        source: 'MoviesScreen',
        region: 'poster-grid',
        itemId: targetMovieId,
        reason:
          token.source === 'detail-close'
            ? 'restore-exact-poster-after-detail-close'
            : 'restore-after-playback-exact-poster',
        maxFrames: snapshotWasVisible
          ? MOVIES_MOUNTED_FOCUS_MAX_FRAMES
          : MOVIES_OFFSCREEN_FOCUS_MAX_FRAMES,
        isActive: () =>
          isMoviesDetailClosingPhase(detailFocusPhaseRef.current) &&
          detailFocusTokenRef.current?.token === token.token,
        getTarget: () => getValidatedPosterTarget(targetMovieId, targetIndex >= 0 ? targetIndex : undefined),
        onSettled: (status) => {
          if (detailFocusTokenRef.current?.token !== token.token) {
            return;
          }
          logMoviesDetailFocusLifecycle({
            token: token.token,
            phase: 'closing-focus',
            targetMovieId,
            targetIndex,
            targetVisible: snapshotWasVisible,
            currentOffset: viewportStateRef.current.offset,
            scrollIssued: scrollIssuedTokenRef.current === token.token,
            focusIssued: status === 'executed',
            actuallyFocusedMovieId: null,
            highlightVisible: false,
            overlayMounted: true,
          });
          if (status === 'timeout') {
            focusIssuedTokenRef.current = null;
            setLockScrollForFocusRestore(false);
            setTimeout(() => setRestorationRetry((value) => value + 1), 0);
          }
        },
      });
    };

    // Mounted targets: skip InteractionManager lag. Offscreen keeps settle wait.
    if (snapshotWasVisible && targetInPage) {
      issueFocusRequest();
    } else {
      InteractionManager.runAfterInteractions(issueFocusRequest);
    }
  }, [
    closingFocusMovieId,
    completeDetailFocusRestore,
    getValidatedPosterTarget,
    restorationRetry,
    setDetailFocusPhaseSafe,
    visibleMovies,
    detailFocusPhase,
    viewportRestoreCommand,
  ]);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    const onHardwareBackPress = wrapOnnMoviesBackHandler(
      'movies-screen',
      () => {
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
              actionTaken:
                playbackClosing || launchingPlayback
                  ? 'ignored-playback-closing'
                  : 'movies-shell-close-playback',
            });
          }
          if (playbackActive && !playbackClosing) {
            closePlayback();
          }
          return true;
        }

        if (
          shouldHandleMoviesDetailBack({
            playbackUiActive: false,
            detailOpen: detailOpen || detailOverlayMounted,
            detailClosing,
          })
        ) {
          closeDetail('back');
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
      },
      () => ({
        screen: 'MoviesScreen',
        guideVisible: guide.visible,
        playbackActive,
        playbackClosing,
        launchingPlayback,
        detailOpen,
        detailOverlayMounted,
        detailClosing,
        searchOpen,
        detailFocusPhase: detailFocusPhaseRef.current,
        selectedCategoryId,
        categoriesLength: categories.length,
        visibleMoviesLength: visibleMovies.length,
        loadStatus,
        gridMounted: isOnnMoviesGridMounted(),
      }),
    );

    const subscription = BackHandler.addEventListener('hardwareBackPress', onHardwareBackPress);

    return () => subscription.remove();
  }, [
    categories.length,
    closeDetail,
    closePlayback,
    closeSearch,
    detailClosing,
    detailOpen,
    detailOverlayMounted,
    guide.visible,
    launchingPlayback,
    loadStatus,
    playbackActive,
    playbackClosing,
    router,
    searchOpen,
    selectedCategoryId,
    visibleMovies.length,
  ]);

  useEffect(() => {
    if (!didJustClose) {
      return;
    }

    setLaunchingPlayback(false);
    finishUnifiedPlaybackClose();
    setDetailSuppressedForPlayback(false);

    // Stage 3G.4: Search-origin playback returns to the same Detail overlay.
    if (detailSourceRef.current === 'search') {
      detailOpenRef.current = true;
      setDetailOpen(true);
      setDetailFocusPhaseSafe('detail-open');
      setSearchPhase('detail-open');
      searchPhaseRef.current = 'detail-open';
      isRestoringPlaybackFocusRef.current = false;
      logMoviesSearchPlayback({
        movieId: selectedMovieRef.current?.id ?? searchRestoreMovieId,
        providerId: activeProviderId,
        detailSource: 'search',
        action: 'playback-returned',
        selectedMoviePresent: Boolean(selectedMovieRef.current),
        streamIdPresent: Boolean(selectedMovieRef.current?.id),
        containerExtensionPresent: Boolean(selectedMovieRef.current?.containerExtension),
        playbackContextPresent: Boolean(bundle),
        resolverInvoked: false,
        playbackStarted: false,
        failureReason: null,
      });
      return;
    }

    // Playback close reuses the same Stage 3D coordinator; keep overlay path
    // available until exact poster confirm when a snapshot exists.
    isRestoringPlaybackFocusRef.current = true;
    if (detailFocusPhaseRef.current === 'detail-open' || detailOpenRef.current) {
      if (beginDetailFocusClose('playback-close')) {
        setRestorationRetry((value) => value + 1);
        return;
      }
    }

    // No snapshot — drop to browse without item-zero preferred focus.
    setDetailOpen(false);
    detailOpenRef.current = false;
    setDetailFocusPhaseSafe('browse');
    isRestoringPlaybackFocusRef.current = false;
  }, [
    activeProviderId,
    beginDetailFocusClose,
    bundle,
    didJustClose,
    searchRestoreMovieId,
    setDetailFocusPhaseSafe,
  ]);

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
    const fromSearch = detailSourceRef.current === 'search';
    const auditOrigin = fromSearch ? 'search-detail' : 'browse-detail';

    beginMoviePlaybackLifecycle({
      origin: auditOrigin,
      movieId: requestedMovie?.id ?? null,
      detailOpen: detailOpenRef.current,
    });

    logMoviesPlayback('play-requested', {
      hasBundle: Boolean(bundle),
      movieId: requestedMovie?.id ?? null,
      playbackActive,
      playbackClosing,
      inFlight: playbackLaunchInFlightRef.current,
      detailSource: detailSourceRef.current,
    });

    if (fromSearch) {
      logMoviesSearchPlayback({
        movieId: requestedMovie?.id ?? null,
        providerId: activeProviderId,
        detailSource: 'search',
        action: 'play-pressed',
        selectedMoviePresent: Boolean(requestedMovie),
        streamIdPresent: Boolean(requestedMovie?.id),
        containerExtensionPresent: Boolean(requestedMovie?.containerExtension),
        playbackContextPresent: Boolean(bundle),
        resolverInvoked: false,
        playbackStarted: false,
        failureReason: null,
      });
    }

    if (!bundle || !requestedMovie) {
      logMoviesPlayback('play-blocked', { reason: 'missing-movie-or-bundle' });
      noteMoviePlaybackFailed('missing-movie-or-bundle', requestedMovie?.id ?? null);
      if (fromSearch) {
        logMoviesSearchPlayback({
          movieId: requestedMovie?.id ?? null,
          providerId: activeProviderId,
          detailSource: 'search',
          action: 'playback-rejected',
          selectedMoviePresent: Boolean(requestedMovie),
          streamIdPresent: Boolean(requestedMovie?.id),
          containerExtensionPresent: Boolean(requestedMovie?.containerExtension),
          playbackContextPresent: Boolean(bundle),
          resolverInvoked: false,
          playbackStarted: false,
          failureReason: 'missing-movie-or-bundle',
        });
      }
      return;
    }

    markMoviePlaybackLifecycle('movie-resolved', { movieId: requestedMovie.id });
    logMoviePlaybackShape({
      origin: auditOrigin,
      movieId: requestedMovie.id,
      contentId: requestedMovie.id,
      streamId: requestedMovie.id,
      providerId: activeProviderId,
      mediaType: 'movie',
      containerExtension:
        movieDetailRef.current?.id === requestedMovie.id
          ? movieDetailRef.current.containerExtension ?? requestedMovie.containerExtension
          : requestedMovie.containerExtension,
      title: requestedMovie.title,
      posterUrl: requestedMovie.posterUrl,
    });

    if (fromSearch) {
      const validated = validateSearchPlaybackMovie(requestedMovie);
      logMoviesSearchPlayback({
        movieId: requestedMovie.id,
        providerId: activeProviderId,
        detailSource: 'search',
        action: 'payload-validated',
        selectedMoviePresent: true,
        streamIdPresent: validated.streamIdPresent,
        containerExtensionPresent: validated.containerExtensionPresent,
        playbackContextPresent: true,
        resolverInvoked: false,
        playbackStarted: false,
        failureReason: validated.failureReason,
      });
      if (!validated.ok) {
        noteMoviePlaybackFailed(validated.failureReason ?? 'payload-invalid', requestedMovie.id);
        showNotification({
          id: PLAYBACK_NOTIFICATION_ID,
          type: 'error',
          title: 'Playback unavailable',
          message:
            validated.failureReason === 'missing-stream-id'
              ? 'This movie is missing a stream id and cannot play.'
              : 'This movie could not start playing right now.',
          duration: PLAYBACK_NOTIFICATION_DURATION_MS,
          position: 'bottom-right',
          scope: 'movies',
        });
        logMoviesSearchPlayback({
          movieId: requestedMovie.id,
          providerId: activeProviderId,
          detailSource: 'search',
          action: 'playback-rejected',
          selectedMoviePresent: true,
          streamIdPresent: validated.streamIdPresent,
          containerExtensionPresent: validated.containerExtensionPresent,
          playbackContextPresent: true,
          resolverInvoked: false,
          playbackStarted: false,
          failureReason: validated.failureReason,
        });
        return;
      }
    }

    if (playbackActive || playbackClosing || playbackLaunchInFlightRef.current) {
      logMoviesPlayback('play-blocked', { reason: 'playback-busy' });
      noteMoviePlaybackFailed('playback-busy', requestedMovie.id);
      return;
    }

    const now = Date.now();
    if (now - lastPlaybackLaunchAtRef.current < 800) {
      logMoviesPlayback('play-blocked', { reason: 'debounce' });
      noteMoviePlaybackFailed('debounce', requestedMovie.id);
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
        noteMoviePlaybackFailed('movie-selection-changed', requestedMovie.id);
        if (fromSearch) {
          logMoviesSearchPlayback({
            movieId: requestedMovie.id,
            providerId: activeProviderId,
            detailSource: 'search',
            action: 'playback-rejected',
            selectedMoviePresent: Boolean(currentMovie),
            streamIdPresent: Boolean(currentMovie?.id),
            containerExtensionPresent: Boolean(currentMovie?.containerExtension),
            playbackContextPresent: true,
            resolverInvoked: false,
            playbackStarted: false,
            failureReason: 'movie-selection-changed',
          });
        }
        return;
      }

      const latestMovieDetail = movieDetailRef.current;
      const matchingDetail =
        latestMovieDetail?.id === currentMovie.id
          ? latestMovieDetail
          : null;

      if (fromSearch) {
        logMoviesSearchPlayback({
          movieId: currentMovie.id,
          providerId: activeProviderId,
          detailSource: 'search',
          action: 'resolver-invoked',
          selectedMoviePresent: true,
          streamIdPresent: true,
          containerExtensionPresent: Boolean(
            matchingDetail?.containerExtension || currentMovie.containerExtension,
          ),
          playbackContextPresent: true,
          resolverInvoked: true,
          playbackStarted: false,
          failureReason: null,
        });
      }

      markMoviePlaybackLifecycle('source-resolution-started', { movieId: currentMovie.id });
      const streamUrl = buildMoviePlaybackUrlResolved(
        bundle,
        currentMovie.id,
        matchingDetail?.containerExtension,
        currentMovie.containerExtension,
      );

      if (!streamUrl) {
        noteMoviePlaybackFailed('stream-url-unavailable', currentMovie.id);
        if (fromSearch) {
          logMoviesSearchPlayback({
            movieId: currentMovie.id,
            providerId: activeProviderId,
            detailSource: 'search',
            action: 'playback-rejected',
            selectedMoviePresent: true,
            streamIdPresent: true,
            containerExtensionPresent: Boolean(
              matchingDetail?.containerExtension || currentMovie.containerExtension,
            ),
            playbackContextPresent: true,
            resolverInvoked: true,
            playbackStarted: false,
            failureReason: 'stream-url-unavailable',
          });
        }
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

      markMoviePlaybackLifecycle('source-resolved', {
        movieId: currentMovie.id,
      });
      logMoviePlaybackShape({
        origin: auditOrigin,
        movieId: currentMovie.id,
        contentId: currentMovie.id,
        streamId: currentMovie.id,
        providerId: activeProviderId,
        mediaType: 'movie',
        containerExtension:
          matchingDetail?.containerExtension ?? currentMovie.containerExtension,
        playbackSource: 'resolved',
        title: currentMovie.title,
        posterUrl: currentMovie.posterUrl,
      });

      lastPlaybackLaunchAtRef.current = Date.now();
      playFocusGuardUntilRef.current = Date.now() + 2000;
      // Keep Search phase on detail-open; do not restore Search results while launching.
      setDetailSuppressedForPlayback(true);
      dismissNotification(PLAYBACK_NOTIFICATION_ID);

      logMoviesPlayback('launch-start', {
        movieId: currentMovie.id,
      });

      markMoviePlaybackLifecycle('launcher-called', { movieId: currentMovie.id });
      markMoviePlaybackLifecycle('player-requested', { movieId: currentMovie.id });
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

      if (fromSearch) {
        logMoviesSearchPlayback({
          movieId: currentMovie.id,
          providerId: activeProviderId,
          detailSource: 'search',
          action: 'playback-started',
          selectedMoviePresent: true,
          streamIdPresent: true,
          containerExtensionPresent: Boolean(
            matchingDetail?.containerExtension || currentMovie.containerExtension,
          ),
          playbackContextPresent: true,
          resolverInvoked: true,
          playbackStarted: true,
          failureReason: null,
        });
      }
    } catch (error) {
      logMoviesPlayback('launch-failed', {
        movieId: requestedMovie.id,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorMessage: error instanceof Error ? error.message : String(error),
      });

      setDetailSuppressedForPlayback(false);
      noteMoviePlaybackFailed(
        error instanceof Error ? error.message : 'launch-failed',
        requestedMovie.id,
      );

      if (fromSearch) {
        logMoviesSearchPlayback({
          movieId: requestedMovie.id,
          providerId: activeProviderId,
          detailSource: 'search',
          action: 'playback-rejected',
          selectedMoviePresent: true,
          streamIdPresent: Boolean(requestedMovie.id),
          containerExtensionPresent: Boolean(requestedMovie.containerExtension),
          playbackContextPresent: Boolean(bundle),
          resolverInvoked: true,
          playbackStarted: false,
          failureReason: 'launch-failed',
        });
      }

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

  const openMovieDetailFromSearch = useCallback(
    (
      movie: Parameters<typeof selectMovie>[0],
      meta: { searchQuery: string; searchFocusedMovieId: string },
    ) => {
      if (
        playbackLaunchInFlightRef.current ||
        launchingPlayback ||
        playbackUiActive ||
        Date.now() < playFocusGuardUntilRef.current
      ) {
        return false;
      }

      // Keep a browse snapshot for safety, but Search-origin close will not use it.
      browseFocusSnapshotRef.current = createMoviesBrowseFocusSnapshot({
        categoryId: selectedCategoryId,
        movieId: movie.id,
        movieIndex: Math.max(0, visibleMovies.findIndex((item) => item.id === movie.id)),
        verticalOffset: viewportStateRef.current.offset,
        visibleFirstIndex: viewportStateRef.current.firstIndex,
        visibleLastIndex: viewportStateRef.current.lastIndex,
        columns: getSeriesPosterColumns(width),
      });

      setDetailSource('search');
      detailSourceRef.current = 'search';
      searchQueryForSelectionRef.current = meta.searchQuery;
      setSearchRestoreMovieId(meta.searchFocusedMovieId);
      selectMovie(movie);
      detailOpenRef.current = true;
      const detailPromise = loadMovieDetail(movie, { origin: 'search' });
      pendingDetailPromiseRef.current = detailPromise;
      detailPromise.finally(() => {
        if (pendingDetailPromiseRef.current === detailPromise) {
          pendingDetailPromiseRef.current = null;
        }
      });
      setDetailSuppressedForPlayback(false);
      releasePostRestoreLatch('screen-change');
      setDetailOpen(true);
      setDetailFocusPhaseSafe('detail-open');
      // Diagnostics-only shape snapshot at Search Detail open.
      logMoviePlaybackShape({
        origin: 'search-detail',
        movieId: movie.id,
        contentId: movie.id,
        streamId: movie.id,
        providerId: activeProviderId,
        mediaType: 'movie',
        containerExtension: movie.containerExtension,
        title: movie.title,
        posterUrl: movie.posterUrl,
      });
      logMoviesDetailFocusLifecycle({
        token: null,
        phase: 'detail-open',
        targetMovieId: movie.id,
        targetIndex: browseFocusSnapshotRef.current.movieIndex,
        targetVisible: true,
        currentOffset: viewportStateRef.current.offset,
        scrollIssued: false,
        focusIssued: false,
        actuallyFocusedMovieId: movie.id,
        highlightVisible: true,
        overlayMounted: true,
      });
      return true;
    },
    [
      activeProviderId,
      launchingPlayback,
      loadMovieDetail,
      playbackUiActive,
      releasePostRestoreLatch,
      selectMovie,
      selectedCategoryId,
      setDetailFocusPhaseSafe,
      visibleMovies,
      width,
    ],
  );

  const handleSearchSelect = useCallback(
    (result: SearchResult) => {
      if (result.type !== 'movie') {
        return;
      }
      if (searchPhaseRef.current === 'opening-detail' || searchPhaseRef.current === 'detail-open') {
        return;
      }

      const requestId = getActiveMoviesSearchRequestId();
      const query = searchQueryForSelectionRef.current;
      logMoviesSearchSelection({
        requestId,
        query,
        movieId: result.id,
        action: 'result-pressed',
        searchPhase: searchPhaseRef.current,
        detailSource: 'search',
        searchOpen: true,
        detailOpen: detailOpenRef.current,
        selectedMovieStored: false,
        overlayVisible: true,
      });

      setSearchPhase('opening-detail');
      searchPhaseRef.current = 'opening-detail';

      const movie = movieSummaryFromSearchResult({
        id: result.id,
        title: result.title,
        year: result.year,
        rating: result.rating,
        genres: result.genres,
        posterUrl: result.posterUrl,
        categoryId: result.categoryId,
        containerExtension: result.containerExtension,
        fallbackCategoryId: selectedCategoryId,
      });

      logMoviesSearchSelection({
        requestId,
        query,
        movieId: movie.id,
        action: 'movie-captured',
        searchPhase: 'opening-detail',
        detailSource: 'search',
        searchOpen: true,
        detailOpen: false,
        selectedMovieStored: true,
        overlayVisible: true,
      });

      logMoviesSearchSelection({
        requestId,
        query,
        movieId: movie.id,
        action: 'search-hiding',
        searchPhase: 'opening-detail',
        detailSource: 'search',
        searchOpen: true,
        detailOpen: false,
        selectedMovieStored: true,
        overlayVisible: false,
      });

      logMoviesSearchSelection({
        requestId,
        query,
        movieId: movie.id,
        action: 'detail-opening',
        searchPhase: 'opening-detail',
        detailSource: 'search',
        searchOpen: true,
        detailOpen: false,
        selectedMovieStored: true,
        overlayVisible: false,
      });

      const opened = openMovieDetailFromSearch(movie, {
        searchQuery: query,
        searchFocusedMovieId: movie.id,
      });
      if (!opened) {
        setSearchPhase('open-results');
        searchPhaseRef.current = 'open-results';
        return;
      }

      setSearchPhase('detail-open');
      searchPhaseRef.current = 'detail-open';
      logMoviesSearchSelection({
        requestId,
        query,
        movieId: movie.id,
        action: 'detail-opened',
        searchPhase: 'detail-open',
        detailSource: 'search',
        searchOpen: true,
        detailOpen: true,
        selectedMovieStored: true,
        overlayVisible: false,
      });
    },
    [openMovieDetailFromSearch, selectedCategoryId],
  );

  const executeMovieSearch = useCallback(
    async (request: Parameters<typeof searchMovies>[2]) => {
      const selection = await resolveMoviesSearchDatasource({
        providerId: activeProviderId,
        query: request.query,
        // Prefer the same SQLite browse source; never route to Xtream bundle when v2 is ready.
        browseDataSource:
          process.env.EXPO_PUBLIC_MOVIES_SQLITE_READS === 'true'
            ? createSqliteMovieDataSource(activeProviderId)
            : null,
        bundleMovies: bundle?.movies,
      });
      return searchMovies(activeProviderId, selection.dataSource, request);
    },
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
    void loadMovieDetail(movie, {
      origin: detailSourceRef.current === 'search' ? 'search' : 'browse',
    });
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

    if (isMoviesDetailClosingPhase(detailFocusPhaseRef.current) || detailFocusTokenRef.current) {
      return;
    }

    // Stage 3D.2: do not compete with restored-poster ownership via first-poster request.
    if (isMoviesPostRestoreLatchActive(postRestoreLatchRef.current)) {
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
      if (
        cancelled ||
        categoryFocusPendingRef.current !== selectedCategoryId ||
        isMoviesPostRestoreLatchActive(postRestoreLatchRef.current)
      ) {
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
          categoryFocusPendingRef.current === selectedCategoryId &&
          !isMoviesPostRestoreLatchActive(postRestoreLatchRef.current),
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

  const continueWatchingEntry = useMemo(() => {
    if (!selectedMovie) return null;
    return library.state.watchHistory.find((entry) => entry.movieId === selectedMovie.id) ?? null;
  }, [library.state.watchHistory, selectedMovie]);

  const continueWatchingLabel = useMemo(
    () => resolveContinueWatchingLabel(continueWatchingEntry?.progressPercent),
    [continueWatchingEntry?.progressPercent],
  );

  const relatedMovies = useMemo(() => {
    if (!selectedMovie) return [];
    return selectRelatedMovies(selectedMovie, visibleMovies, MOVIE_DETAIL_RELATED_LIMIT);
  }, [selectedMovie, visibleMovies]);

  const handleSelectRelatedMovie = useCallback(
    (movie: (typeof visibleMovies)[number]) => {
      handleSelectMovie(movie);
    },
    [handleSelectMovie],
  );

  const gridEmptyNotice =
    !loading && visibleMovies.length === 0 && loadStatus === 'error'
      ? 'No movies to display right now.'
      : !loading && visibleMovies.length === 0 && loadStatus === 'empty'
        ? 'No movies in this category.'
        : null;
  const hasUsableItems = visibleMovies.length > 0;
  const categoriesLoading = categories.length === 0 && loadStatus !== 'error';
  const paginationLoading = loading && !categoryLoading;
  const detailBlocksBrowse = detailOpen || detailClosing || detailOverlayVisible;
  const gateVisible = isMoviesPrimaryLoaderGateVisible({
    categoriesLoading,
    loadingCategoryId: firstPageLoadGate.loadingCategoryId,
    firstPageResolvedCategoryId: firstPageLoadGate.firstPageResolvedCategoryId,
  });
  const gatePrimaryMode: MoviesPrimaryLoaderMode = deriveMoviesPrimaryLoaderModeFromGate({
    categoriesLoading,
    loadingCategoryId: firstPageLoadGate.loadingCategoryId,
    firstPageResolvedCategoryId: firstPageLoadGate.firstPageResolvedCategoryId,
    hasUsableItems,
  });
  const [primaryHoldVisible, setPrimaryHoldVisible] = useState(false);
  const primaryShownAtRef = useRef(0);
  const primaryHideReasonRef = useRef<MoviesPrimaryLoaderHideReason>(null);
  const primaryLoaderVisible = gateVisible || primaryHoldVisible;
  const primaryLoaderMode: MoviesPrimaryLoaderMode = primaryLoaderVisible
    ? gatePrimaryMode === 'hidden'
      ? hasUsableItems
        ? 'category-blocking'
        : 'initial'
      : gatePrimaryMode
    : 'hidden';
  const paginationLoaderMode: MoviesPaginationLoaderMode = deriveMoviesPaginationLoaderMode({
    primaryVisible: primaryLoaderVisible,
    paginationLoading,
    hasUsableItems,
    detailBlocksBrowse,
  });
  const paginationLoaderVisible = paginationLoaderMode === 'loading-more';
  const primaryLoaderLabel = resolveMoviesPrimaryLoaderLabel({
    primaryMode: primaryLoaderMode === 'hidden' && primaryLoaderVisible ? 'initial' : primaryLoaderMode,
    categoryDisplayName: categories.length > 0 ? selectedCategoryLabel : null,
    hasCategories: categories.length > 0,
    catalogRepairing,
  });
  const firstPageReady =
    firstPageLoadGate.loadingCategoryId != null &&
    firstPageLoadGate.firstPageResolvedCategoryId === firstPageLoadGate.loadingCategoryId;
  const primaryDiagRef = useRef<string | null>(null);
  const paginationDiagRef = useRef<string | null>(null);

  // Stage 3E.2: keep primary loader up through first-page readiness + min duration.
  useEffect(() => {
    if (gateVisible) {
      if (!primaryHoldVisible) {
        primaryShownAtRef.current = Date.now();
        primaryHideReasonRef.current = null;
        setPrimaryHoldVisible(true);
      }
      return;
    }

    if (!primaryHoldVisible) {
      return;
    }

    const elapsed = Date.now() - primaryShownAtRef.current;
    const remaining = MOVIES_PRIMARY_LOADER_MIN_MS - elapsed;
    if (remaining <= 0) {
      primaryHideReasonRef.current = firstPageReady ? 'first-page-ready' : 'minimum-duration';
      setPrimaryHoldVisible(false);
      return;
    }

    primaryHideReasonRef.current = null;
    const timer = setTimeout(() => {
      primaryHideReasonRef.current = firstPageReady ? 'minimum-duration' : 'minimum-duration';
      setPrimaryHoldVisible(false);
    }, remaining);
    return () => clearTimeout(timer);
  }, [firstPageReady, gateVisible, primaryHoldVisible]);

  useEffect(() => {
    const diagKey = JSON.stringify({
      mode: primaryLoaderMode,
      visible: primaryLoaderVisible,
      loadingCategoryId: firstPageLoadGate.loadingCategoryId,
      requestToken: firstPageLoadGate.loadingRequestToken,
      firstPageReady,
      hasUsableItems,
      minimumDurationMet: !primaryHoldVisible || Date.now() - primaryShownAtRef.current >= MOVIES_PRIMARY_LOADER_MIN_MS,
      hideReason: primaryLoaderVisible ? null : primaryHideReasonRef.current,
    });
    if (primaryDiagRef.current === diagKey) {
      return;
    }
    primaryDiagRef.current = diagKey;
    logMoviesPrimaryLoader({
      mode: primaryLoaderMode,
      selectedCategoryId,
      selectedCategoryName: categories.length > 0 ? selectedCategoryLabel : null,
      loadingCategoryId: firstPageLoadGate.loadingCategoryId,
      requestToken: firstPageLoadGate.loadingRequestToken,
      firstPageReady,
      minimumDurationMet:
        !primaryHoldVisible || Date.now() - primaryShownAtRef.current >= MOVIES_PRIMARY_LOADER_MIN_MS,
      visible: primaryLoaderVisible,
      hideReason: primaryLoaderVisible ? null : primaryHideReasonRef.current,
      hasUsableItems,
    });
  }, [
    categories.length,
    firstPageLoadGate.loadingCategoryId,
    firstPageLoadGate.loadingRequestToken,
    firstPageReady,
    hasUsableItems,
    primaryHoldVisible,
    primaryLoaderMode,
    primaryLoaderVisible,
    selectedCategoryId,
    selectedCategoryLabel,
  ]);

  useEffect(() => {
    const diagKey = JSON.stringify({
      mode: paginationLoaderMode,
      visible: paginationLoaderVisible,
      categoryId: selectedCategoryId,
      currentItemCount: visibleMovies.length,
      requestPending: paginationLoading,
      hasNextPage: hasMore,
      primaryLoaderVisible,
    });
    if (paginationDiagRef.current === diagKey) {
      return;
    }
    paginationDiagRef.current = diagKey;
    logMoviesPaginationLoader({
      mode: paginationLoaderMode,
      visible: paginationLoaderVisible,
      categoryId: selectedCategoryId,
      currentItemCount: visibleMovies.length,
      requestPending: paginationLoading,
      hasNextPage: hasMore,
      primaryLoaderVisible,
      placement: 'list-stage-bottom-center-overlay',
    });
  }, [
    hasMore,
    paginationLoaderMode,
    paginationLoaderVisible,
    paginationLoading,
    primaryLoaderVisible,
    selectedCategoryId,
    visibleMovies.length,
  ]);

  useEffect(() => {
    if (primaryLoaderMode === 'initial') {
      recordFocusAudit({
        component: 'MoviesScreen.loader-anchor',
        action: 'hasTVPreferredFocus',
        itemId: selectedCategoryId,
        detail: {
          preferred: Boolean(restoringBrowseFocus && categoryFocusPendingRef.current === selectedCategoryId),
        },
      });
    }
  }, [primaryLoaderMode, restoringBrowseFocus, selectedCategoryId]);

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

  const postersFocusable =
    areMoviesPostersNormallyFocusable(detailFocusPhase) && !playbackUiActive && !searchBlocksBrowse;
  const restoreToken = detailFocusTokenRef.current;

  // Stage 3E.3: single primary/pagination loader trees (absolute overlays inside listStage).
  const primaryLoaderNode = primaryLoaderVisible ? (
    <View
      style={styles.primaryLoaderOverlay}
      pointerEvents="none"
      accessible={false}
      focusable={false}>
      {primaryLoaderMode === 'category-blocking' ? <View style={styles.primaryLoaderDim} /> : null}
      <View style={styles.primaryLoaderContent}>
        <Text style={styles.primaryLoaderLabel} numberOfLines={1}>
          {primaryLoaderLabel}
        </Text>
        <NovaSpaceLoader label={primaryLoaderLabel} variant="hero" />
      </View>
    </View>
  ) : null;

  const paginationLoaderNode = paginationLoaderVisible ? (
    <View
      style={styles.paginationLoaderBar}
      pointerEvents="none"
      accessible={false}
      focusable={false}>
      <BlurView intensity={10} tint="dark" style={styles.paginationLoaderPill}>
        <NovaSpaceLoader label={MOVIES_PAGINATION_LOADER_LABEL} variant="inline" />
      </BlurView>
    </View>
  ) : null;

  return (
    <View style={styles.root}>
      <>
      <View
        ref={browseLayerRef}
        collapsable={false}
        style={[styles.browseLayer, playbackUiActive && styles.browseLayerHidden]}
        pointerEvents={
          // During Stage 3D closing, allow the exact target poster to receive focus
          // while the overlay remains mounted above.
          detailClosing
            ? 'auto'
            : detailOpen || searchBlocksBrowse || playbackUiActive
              ? 'none'
              : 'auto'
        }
        importantForAccessibility={
          (detailOpen && !detailClosing) || searchBlocksBrowse || playbackUiActive
            ? 'no-hide-descendants'
            : 'auto'
        }
        accessibilityElementsHidden={
          Boolean(detailOpen && !detailClosing) || searchBlocksBrowse || playbackUiActive
        }>
      <NovaTvShell
        activeId="movies"
        providerLabel={selectedProviderLabel}
        preferActiveNavigationFocus={shouldPreferNavigationFocus({
          playbackUiActive,
          detailOverlayVisible: detailOverlayVisible || detailClosing || focusSuppressionActive,
          searchBlocksBrowse,
          restoringBrowseFocus:
            restoringBrowseFocus || detailClosing || focusSuppressionActive || postRestoreActive,
          gridEmpty: visibleMovies.length === 0,
        })}
        suppressNavbarPreferredFocus={navbarPreferredSuppressed}
        navigationFocusable={chromeFocusable && !searchBlocksBrowse}
        compactNavigationRail>
        <View style={styles.screen}>
          <View style={styles.topBar}>
            <View style={styles.headingBlock}>
              <Text style={styles.heading}>Movies</Text>
              <Text style={styles.copy}>Thousands of movies. Any genre. Anytime.</Text>
            </View>
            <MovieToolbar
              focusable={chromeFocusable && !searchBlocksBrowse}
              hasTVPreferredFocus={false}
              onSearchFocus={() => {
                actualFocusedComponentRef.current = 'MovieToolbar.Search';
                if (restoreTimingRef.current) {
                  restoreTimingRef.current.searchFocusAttempted = true;
                }
                if (!postRestoreLatchRef.current?.postRestoreActive) {
                  return;
                }
                // Should not happen while focusable={false}; log if native still delivers focus.
                logMoviesSearchFocusBlocked({
                  token: postRestoreLatchRef.current.token,
                  reason: 'post-restore-latch-focusable-false-bypass',
                  source: 'MovieToolbar.onFocus',
                });
              }}
              onSearchPress={() => {
                const phase = searchPhaseRef.current;
                if (shouldBlockMoviesSearchToolbar(phase)) {
                  logMoviesSearchReopen({
                    phase,
                    searchOpen: true,
                    overlayMounted: true,
                    toolbarPressAccepted: false,
                    blockedReason: 'detail-transition',
                  });
                  return;
                }
                if (!chromeFocusable || (searchBlocksBrowse && !shouldToggleCloseMoviesSearch(phase))) {
                  if (postRestoreActive) {
                    logMoviesSearchFocusBlocked({
                      token: postRestoreLatchRef.current?.token ?? null,
                      reason: 'post-restore-latch-not-focusable',
                      source: 'MovieToolbar.onSearchPress',
                    });
                  }
                  logMoviesSearchReopen({
                    phase,
                    searchOpen: searchOpen,
                    overlayMounted: isMoviesSearchOverlayMounted(phase),
                    toolbarPressAccepted: false,
                    blockedReason: 'chrome-not-focusable',
                  });
                  return;
                }
                logMoviesPlayback('search-open', {});
                if (shouldToggleCloseMoviesSearch(phase)) {
                  // Idempotent while already open: close fully and reset.
                  logMoviesSearchReopen({
                    phase,
                    searchOpen: true,
                    overlayMounted: true,
                    toolbarPressAccepted: true,
                    blockedReason: null,
                  });
                  closeSearch();
                  return;
                }

                setSearchPhase('open-input');
                searchPhaseRef.current = 'open-input';
                logMoviesSearchReopen({
                  phase: 'open-input',
                  searchOpen: true,
                  overlayMounted: true,
                  toolbarPressAccepted: true,
                  blockedReason: null,
                });
              }}
            />
          </View>

          <View style={styles.contentRow}>
            <MovieCategoryRail
              categories={railCategories}
              selectedCategoryId={selectedCategoryId}
              preferredCategoryId={
                selectedCategoryId && selectedCategoryId !== 'all'
                  ? selectedCategoryId
                  : moviesMemory.selectedCategoryId !== 'all'
                    ? moviesMemory.selectedCategoryId
                    : null
              }
              suppressPreferredFocus={categoryPreferredSuppressed}
              focusable={chromeFocusable && !searchBlocksBrowse}
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
              {/* Stage 3B.2 focus anchor — separate from Stage 3E/3E.1 visual loaders. */}
              {primaryLoaderMode === 'initial' ? (
                <Pressable
                  focusable
                  hasTVPreferredFocus={
                    !focusSuppressionActive &&
                    !detailClosing &&
                    !detailOpen &&
                    !postRestoreActive &&
                    Boolean(restoringBrowseFocus && categoryFocusPendingRef.current === selectedCategoryId)
                  }
                  accessibilityRole="none"
                  accessibilityLabel="Movies loading"
                  onPress={() => undefined}
                  style={styles.loadingFocusAnchor}
                />
              ) : null}

              {categories.length > 0 ? (
                <View
                  style={[
                    styles.gridStage,
                    primaryLoaderMode === 'category-blocking' && styles.gridStageDimmed,
                  ]}
                  pointerEvents={primaryLoaderMode === 'category-blocking' ? 'none' : 'auto'}>
                  <MoviePosterGrid
                    movies={visibleMovies}
                    selectedCategoryLabel={selectedCategoryLabel}
                    selectedCategoryId={selectedCategoryId}
                    columns={posterColumns}
                    hasMore={hasMore}
                    loading={loading}
                    emptyNotice={gridEmptyNotice}
                    selectedMovieId={selectedMovie?.id ?? null}
                    suppressPreferredFocus={
                      focusSuppressionActive ||
                      detailClosing ||
                      Boolean(restoreToken) ||
                      postRestoreActive ||
                      primaryLoaderMode === 'category-blocking'
                    }
                    postersFocusable={postersFocusable && primaryLoaderMode !== 'category-blocking'}
                    closingFocusMovieId={activeClosingFocusMovieId}
                    postRestorePreferredMovieId={postRestorePreferredMovieId}
                    pinnedHighlightMovieId={pinnedHighlightMovieId}
                    lockScrollForFocusRestore={lockScrollForFocusRestore}
                    snapshotTargetWasVisible={snapshotTargetWasVisible}
                    viewportRestoreCommand={viewportRestoreCommand}
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
                    restoreMovieId={restoreToken?.snapshot.movieId ?? null}
                    restoreMovieIndex={restoreToken?.snapshot.movieIndex ?? null}
                    restoreScrollOffset={restoreToken?.snapshot.verticalOffset ?? null}
                    restoreVisibleFirstIndex={restoreToken?.snapshot.visibleFirstIndex ?? null}
                    restoreVisibleLastIndex={restoreToken?.snapshot.visibleLastIndex ?? null}
                    restorationToken={restoreToken?.token ?? null}
                    restoreScrollBlocked={
                      restoreScrollBlockedRef.current ||
                      detailFocusPhase === 'browse-restored' ||
                      detailFocusPhase === 'browse'
                    }
                    onViewportChange={handleViewportChange}
                    listOverlays={
                      <>
                        {primaryLoaderNode}
                        {paginationLoaderNode}
                      </>
                    }
                  />
                </View>
              ) : (
                <View style={styles.gridStage}>{primaryLoaderNode}</View>
              )}
            </View>

          </View>
        </View>
      </NovaTvShell>
        </View>

      <MovieDetailOverlay
        visible={detailOverlayVisible}
        focusHandoffActive={focusHandoffActive}
        closeTargetRef={overlayCloseTargetRef}
        blurTarget={browseLayerRef}
        detail={
          selectedMovie
            ? movieDetail?.id === selectedMovie.id
              ? movieDetail
              : buildMoviePreviewDetail(selectedMovie)
            : null
        }
        detailError={null}
        detailLoading={detailLoading && !focusHandoffActive}
        continueWatchingLabel={continueWatchingLabel}
        continueWatchingProgress={continueWatchingEntry?.progressPercent ?? null}
        relatedMovies={relatedMovies}
        isFavorite={selectedMovie ? library.isFavorite(selectedMovie.id) : false}
        isWatchlisted={selectedMovie ? library.isWatchlisted(selectedMovie.id) : false}
        onClose={() => closeDetail('x')}
        onPlay={focusHandoffActive ? undefined : selectedMovie ? startPlayback : undefined}
        onRetry={focusHandoffActive ? undefined : selectedMovie ? handleDetailRetry : undefined}
        onSelectRelated={focusHandoffActive ? undefined : handleSelectRelatedMovie}
        onTrailerPress={
          movieDetail?.trailerUrl
            ? () => {
                void Linking.openURL(movieDetail.trailerUrl!);
              }
            : undefined
        }
        onFavoritePress={
          focusHandoffActive || !selectedMovie
            ? undefined
            : () => {
                void toggleFavorite(activeProviderId, selectedMovie.id);
              }
        }
        onWatchlistPress={
          focusHandoffActive || !selectedMovie
            ? undefined
            : () => {
                void toggleWatchlist(activeProviderId, selectedMovie.id);
              }
        }
      />
        </>

      <SearchOverlay
        visible={searchOverlayVisible && !playbackUiActive}
        // Keep Search controller/results alive across Detail + playback (no Modal while hidden).
        retainMounted={searchOpen && !playbackUiActive}
        restoreFocusMovieId={searchPhase === 'returning' ? searchRestoreMovieId : null}
        onRestoreFocusHandled={() => {
          if (searchPhaseRef.current !== 'returning') {
            return;
          }
          setSearchPhase('open-results');
          searchPhaseRef.current = 'open-results';
          logMoviesSearchSelection({
            requestId: getActiveMoviesSearchRequestId(),
            query: searchQueryForSelectionRef.current,
            movieId: searchRestoreMovieId,
            action: 'search-restored',
            searchPhase: 'open-results',
            detailSource: 'search',
            searchOpen: true,
            detailOpen: false,
            selectedMovieStored: Boolean(searchRestoreMovieId),
            overlayVisible: true,
          });
        }}
        scope="movie"
        providerId={activeProviderId}
        title="Search Movies"
        executeSearch={executeMovieSearch}
        onReady={() => {
          setSearchOverlayReady(true);
          if (searchPhaseRef.current === 'open-input') {
            setSearchPhase('open-results');
            searchPhaseRef.current = 'open-results';
          }
        }}
        onClose={closeSearch}
        onSelectResult={handleSearchSelect}
        onQueryCommitted={(query) => {
          searchQueryForSelectionRef.current = query;
          if (searchPhaseRef.current === 'open-input') {
            setSearchPhase('open-results');
            searchPhaseRef.current = 'open-results';
          }
        }}
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
      position: 'relative',
      minHeight: 280,
    },
    gridStage: {
      flex: 1,
      minHeight: 280,
      backgroundColor: 'transparent',
    },
    gridStageDimmed: {
      opacity: 0.42,
    },
    // Stage 3E.3: fill MoviePosterGrid listStage viewport only (not full TV shell).
    primaryLoaderOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'flex-start',
      backgroundColor: 'transparent',
      borderWidth: 0,
      zIndex: 3,
    },
    primaryLoaderDim: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0, 0, 0, 0.28)',
    },
    primaryLoaderContent: {
      position: 'absolute',
      // ~42% down the poster list viewport; nudge up by half stack height.
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
    primaryLoaderLabel: {
      color: theme.colors.textPrimary,
      fontSize: 22,
      fontWeight: '800',
      letterSpacing: 0.2,
      textAlign: 'center',
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
    loadingFocusAnchor: {
      position: 'absolute',
      width: 2,
      height: 2,
      opacity: 0.01,
      zIndex: 2,
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
