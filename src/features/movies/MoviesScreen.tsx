import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { ElementRef } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
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
  areMoviesBackgroundFocusablesEnabled,
  logResumeFocus,
  logResumeInputAudit,
  shouldIgnoreMoviesRemoteInput,
} from '@/features/playback/continuity/playbackResumeFocus';
import { isPlaybackResumePromptOpen, subscribePlaybackResumePrompt } from '@/features/playback/continuity/playbackResumeGate';
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
import { MovieDetailPopupV2 } from './components/MovieDetailPopupV2';
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
import {
  createMoviesBrowsePlaybackReturnTarget,
  createMoviesDetailPlaybackReturnTarget,
  createMoviesSearchDetailPlaybackReturnTarget,
  isMoviesPlaybackReturnToDetail,
  logMoviesPlaybackReturn,
  MOVIES_FOCUS_STAGE4G_MARKER,
  shouldMoviesCloseDetailOnBack,
  shouldMoviesHostHandlePlaybackBack,
  type MoviesPlaybackReturnTarget,
} from './moviesPlaybackReturnTarget';
import {
  createMoviesDetailXCloseActivationLock,
  MOVIES_FOCUS_STAGE4H_MARKER,
  resetMoviesDetailXCloseActivationLock,
  shouldFocusMoviesDetailHiddenHandoffTarget,
  shouldPreserveMoviesDetailCloseButtonFocus,
  shouldResetMoviesDetailXCloseActivationLock,
  tryAcquireMoviesDetailXCloseActivation,
  type MoviesDetailXCloseActivationLock,
} from './moviesDetailXCloseFocus';
import {
  createMoviesDetailCloseTransaction,
  isMoviesDetailCloseTargetRefValid,
  MOVIES_FOCUS_STAGE4J_MARKER,
  shouldDropMoviesDetailCloseCallback,
  tryCommitMoviesDetailCloseReveal,
  type MoviesDetailCloseTransaction,
} from './moviesDetailCloseTransaction';
import {
  createMoviesCategoryRailInstanceId,
  createMoviesDetailCloseFocusAttempt,
  createMoviesDetailCloseImmutableTarget,
  createMoviesDetailOverlayInstanceId,
  isMoviesCategoryRailExpectedVisible,
  isMoviesCategoryRailVisibilityViolation,
  isMoviesDetailCloseCorrectionUncovered,
  isMoviesDetailCloseTargetMutation,
  MOVIES_CATEGORY_RAIL_WIDTH,
  MOVIES_DETAIL_CLOSE_WATCHDOG_MS,
  MOVIES_DETAIL_FOCUS_MAX_RETRIES,
  MOVIES_FOCUS_STAGE4K_MARKER,
  MOVIES_FOCUS_STAGE4K1_MARKER,
  MOVIES_FOCUS_STAGE4K2_MARKER,
  resolveMoviesDetailCloseRetryTarget,
  shouldAcceptMoviesDetailCloseFocusConfirmation,
  shouldAcceptMoviesDetailCloseLateFocus,
  shouldAbortMoviesDetailCloseAfterFailedAttempts,
  shouldIssueMoviesDetailCloseFocusRequest,
  shouldReleaseMoviesDetailVisualIsolation,
  shouldScheduleMoviesDetailFocusRetry,
  shouldStartMoviesDetailFocusConfirmTimer,
  type MoviesDetailCloseFocusAttempt,
  type MoviesDetailCloseFocusConfirmation,
  type MoviesDetailCloseImmutableTarget,
} from './moviesDetailCloseInstant';
import { MOVIES_FOCUS_STAGE4L_MARKER } from './moviesStartupFastPath';
import {
  buildSanitizedPlaybackSourceSnapshot,
  extractPlaybackHttpStatus,
  MOVIES_FOCUS_STAGE4L1_MARKER,
  releaseMoviesStartupFocusOwnership,
  shouldAllowMoviesToolbarSearchPreferredFocus,
} from './moviesStartupRuntimeIsolation';
import {
  assertMoviesDetailClosedVisualInvariant,
  MOVIES_FOCUS_STAGE4L2_MARKER,
  shouldUseMoviesDetailCloseIsolationCover,
} from './moviesDetailSimpleBack';
import {
  MOVIES_FOCUS_STAGE4M_MARKER,
  MOVIES_SIMPLE_DETAIL_OVERLAY_ENABLED,
  moviesDetailOverlayVisible,
} from './moviesSimpleDetailOverlay';
import {
  logMovieDetailLegacyClosePathViolation,
  logMovieDetailPopupV2Event,
  logMoviesDetailV2FocusOwnership,
} from './moviesDetailPopupV2';
import { normalizePlaybackFailure } from '@/features/analytics/playbackAnalytics';
import type { RequestTvFocusResult } from '@/features/navigation/tvFocusDiagnostics';
import { logDetailOverlayEvent } from '@/features/media-detail';

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
import { isNovaCastTraceLoggingEnabled } from '../diagnostics/novacastLogPolicy.ts';
import { PLAYBACK_NOTIFICATION_DURATION_MS, PLAYBACK_NOTIFICATION_ID } from '@/features/playback/unified/unifiedPlayerLogic';
import { SearchOverlay } from '@/features/search/SearchOverlay';
import { DiscoverZoneOverlay } from '@/features/personalization/DiscoverZoneOverlay';
import {
  DISCOVERY_ZONE_ORIGIN,
  logDiscoverZoneDetailBack,
  logDiscoverZoneDetailOpen,
  shouldReturnToDiscoverZone,
} from '@/features/personalization/discoverZoneNavigation';
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
  getMoviesBrowseListRevision,
  getMoviesOnnTraceSnapshot,
  resetMoviesBrowsePresentationLatches,
  setMoviesBrowseUiFrozenForDetail,
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
  isMoviesFastPathInitialRestoreViolation,
  isMoviesFocusSuppressionActive,
  isMoviesNativeFocusRowAlignmentDrift,
  isMoviesNaturalReturnPhase,
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
  selectMoviesDetailReturnPath,
  shouldHoldMoviesDetailVisual,
  shouldIssueMoviesInitialDetailRestore,
  shouldReRequestMoviesPosterFocusAfterCorrective,
  shouldSkipZeroDeltaInitialRestore,
  shouldSuppressMoviesCategoryFocus,
  shouldSuppressMoviesNavbarFocus,
  shouldUseMoviesNaturalReturnPath,
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

if (isNovaCastTraceLoggingEnabled()) {
  console.info('[NovaCast Movies Diagnostics Build] ' + JSON.stringify({ version: 'movies-detail-focus-lifecycle-v1' }));
}

export function MoviesScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const styles = useMemo(() => createMoviesStyles(theme), [theme]);
  const { width, height } = useWindowDimensions();
  const navigationGateRef = useRef(createTvNavigationGate());
  const { selectedProvider, selectedProviderLabel } = useProviderStore();
  const { bundle } = useActiveProviderBundle();
  const activeProviderId = selectedProvider?.id ?? 'no-provider';
  const [discoverZoneOpen, setDiscoverZoneOpen] = useState(() => Boolean(getMoviesScreenMemory(activeProviderId).openDiscoverZone));
  const [discoverZoneRestoreItemId, setDiscoverZoneRestoreItemId] = useState<string | null>(null);
  const detailLaunchOriginRef = useRef<'browse' | 'search' | typeof DISCOVERY_ZONE_ORIGIN>('browse');
  const moviesMemory = getMoviesScreenMemory(activeProviderId);
  const library = useMovieLibraryStore(activeProviderId);
  useEffect(() => {
    if (!getMoviesScreenMemory(activeProviderId).openDiscoverZone) {
      return;
    }
    rememberMoviesScreenMemory(activeProviderId, { openDiscoverZone: false });
    setDiscoverZoneOpen(true);
  }, [activeProviderId]);
  const guide = useGuideWalkthrough(ONBOARDING_GUIDES.movies.key);
  const posterRefs = useRef<
    Map<string, { instance: ElementRef<typeof View>; contentId: string; instanceToken: string; renderedIndex: number }>
  >(new Map());
  const categoryRowRefs = useRef<Map<string, ElementRef<typeof Pressable>>>(new Map());
  const categoryFocusPendingRef = useRef<string | null>(null);
  const browseFocusSnapshotRef = useRef<MoviesBrowseFocusSnapshot | null>(null);
  const detailOpenContextRef = useRef<MoviesDetailOpenContext | null>(null);
  const detailReturnPathRef = useRef<MoviesDetailReturnPath | null>(null);
  const playbackReturnTargetRef = useRef<MoviesPlaybackReturnTarget | null>(null);
  const detailVisualHoldRef = useRef(false);
  /** Stage 4.2K: opaque isolation until focus + offset confirm. */
  const visualIsolationRef = useRef(false);
  const [visualIsolationActive, setVisualIsolationActive] = useState(false);
  const visualIsolationTokenRef = useRef<string | null>(null);
  const visualCoverTokenRef = useRef<string | null>(null);
  const pendingIsolationFrameRef = useRef<number | null>(null);
  const nativeFocusEnvironmentReadyRef = useRef(false);
  const focusConfirmedTokenRef = useRef<string | null>(null);
  const focusRetryCountRef = useRef(0);
  const overlayInstanceIdRef = useRef(createMoviesDetailOverlayInstanceId());
  /** Stage 4.2K.1: stable category rail identity across Detail open/close. */
  const railInstanceIdRef = useRef(createMoviesCategoryRailInstanceId());
  /** Stage 4.2K.2: immutable target / attempt / confirmation ownership. */
  const immutableCloseTargetRef = useRef<MoviesDetailCloseImmutableTarget | null>(null);
  const focusAttemptRef = useRef<MoviesDetailCloseFocusAttempt | null>(null);
  const focusConfirmationRef = useRef<MoviesDetailCloseFocusConfirmation | null>(null);
  const closeWatchdogTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewportStateRef = useRef({ offset: 0, firstIndex: null as number | null, lastIndex: null as number | null });
  const detailFocusTokenRef = useRef<MoviesDetailFocusToken | null>(null);
  /** Stage 4.2J: one reveal commit per close token. */
  const closeCommitTokenRef = useRef<string | null>(null);
  const closeTransactionRef = useRef<MoviesDetailCloseTransaction | null>(null);
  const closeRafIdsRef = useRef<number[]>([]);
  const searchReturnPendingRef = useRef(false);
  const [searchReturnPending, setSearchReturnPending] = useState(false);
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
  const startupFocusOwnershipActiveRef = useRef(true);
  const startupFocusFrameRef = useRef<number | null>(null);
  const [detailFocusPhase, setDetailFocusPhase] = useState<MoviesDetailFocusPhase>('browse');
  const detailFocusPhaseRef = useRef<MoviesDetailFocusPhase>('browse');
  const [categoryFocusLeftHandle, setCategoryFocusLeftHandle] = useState<number | undefined>();
  const [sortFocusRightHandle, setSortFocusRightHandle] = useState<number | undefined>();
  const searchToolbarRef = useRef<View | null>(null);
  const discoverToolbarRef = useRef<View | null>(null);
  const [searchToolbarFocusHandle, setSearchToolbarFocusHandle] = useState<number | undefined>();
  const [discoverToolbarFocusHandle, setDiscoverToolbarFocusHandle] = useState<number | undefined>();
  const isRestoringPlaybackFocusRef = useRef(false);
  const [restoringBrowseFocus, setRestoringBrowseFocus] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const detailOpenRef = useRef(false);
  /**
   * Stage 4.2N — MovieDetailPopupV2's own simple state. The popup component
   * reads only this; it never observes legacy detailOpen/detailFocusPhase.
   */
  const [detailPopup, setDetailPopup] = useState<{
    open: boolean;
    movie: Parameters<typeof selectMovie>[0] | null;
    originItemId: string | null;
  }>({ open: false, movie: null, originItemId: null });
  const detailPopupOpenRef = useRef(false);
  const detailPopupCloseInFlightRef = useRef(false);
  const previousMoviesDataRef = useRef<unknown>(null);
  const moviesAuditRef = useRef<{ selectedMovieId: string | null; focusedMovieId: string | null }>({
    selectedMovieId: null,
    focusedMovieId: null,
  });
  const [restorationRetry, setRestorationRetry] = useState(0);
  const [detailSuppressedForPlayback, setDetailSuppressedForPlayback] = useState(false);
  const [detailVisualHold, setDetailVisualHold] = useState(false);
  const [closingFocusMovieId, setClosingFocusMovieId] = useState<string | null>(null);
  /**
   * Stage 4.2N fix: unlike the legacy multi-phase close, `closeMovieDetailPopupV2`
   * jumps straight from 'detail-open' to 'browse' in one state transition, so the
   * origin poster's `postersFocusable`-gated `disabled` prop and the header
   * chrome's `chromeFocusable`-gated `disabled` prop both flip in the exact same
   * commit. When nothing currently holds native focus (the popup's own controls
   * just unmounted), Android's own default-focus-search can grab an unrelated
   * newly-focusable header element (observed on device: Search) before our
   * explicit `.focus()` call — even when deferred — reaches a poster whose
   * native `disabled` prop has not yet actually flipped. Marking the origin
   * poster force-focusable synchronously, in the same close transition, removes
   * that dependency on `postersFocusable` settling in time for this one poster.
   */
  const [v2CloseFocusTargetId, setV2CloseFocusTargetId] = useState<string | null>(null);
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
    flushDeferredBrowseCommits,
    reload,
    hasDataSource,
    sortOption,
    setSort,
    categoryHasRatings,
    getFocusedMovieId,
    getListOffset,
    firstPageLoadGate,
    startupInteractive,
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
  const xCloseActivationLockRef = useRef<MoviesDetailXCloseActivationLock>(
    createMoviesDetailXCloseActivationLock(),
  );
  const [preserveXCloseFocus, setPreserveXCloseFocus] = useState(false);
  const [xCloseActivationLocked, setXCloseActivationLocked] = useState(false);
  const gridGateOpenRef = useRef<boolean | null>(null);
  const resumeBackgroundFocusLoggedRef = useRef(false);
  const resumePromptOpen = useSyncExternalStore(
    subscribePlaybackResumePrompt,
    isPlaybackResumePromptOpen,
    isPlaybackResumePromptOpen,
  );
  const playbackUiActive = playbackActive || playbackClosing || launchingPlayback || resumePromptOpen;
  const backgroundTvFocusEnabled = areMoviesBackgroundFocusablesEnabled(resumePromptOpen);
  // Stage 4.2M: guest overlay — no multi-phase closing / isolation handoff.
  const detailClosing = MOVIES_SIMPLE_DETAIL_OVERLAY_ENABLED
    ? false
    : isMoviesDetailClosingPhase(detailFocusPhase);
  const detailOverlayMounted = MOVIES_SIMPLE_DETAIL_OVERLAY_ENABLED
    ? detailOpen
    : isMoviesDetailOverlayMounted(detailFocusPhase);
  const detailOverlayVisible = MOVIES_SIMPLE_DETAIL_OVERLAY_ENABLED
    ? moviesDetailOverlayVisible({
        detailOpen,
        detailSuppressedForPlayback,
        playbackUiActive,
        hasSelectedMovie: Boolean(selectedMovie),
      })
    : (detailOverlayMounted || detailVisualHold) &&
      !detailSuppressedForPlayback &&
      !playbackUiActive &&
      Boolean(selectedMovie);
  const focusHandoffActive = MOVIES_SIMPLE_DETAIL_OVERLAY_ENABLED
    ? false
    : detailClosing || detailVisualHold;
  const detailCloseInFlightRef = useRef(false);
  const naturalReturnActive = isMoviesNaturalReturnPhase(detailFocusPhase);
  const allowOffscreenInitialRestore =
    !naturalReturnActive && !isMoviesDetailReturnFastPath(detailReturnPathRef.current);
  const preserveCloseButtonFocus =
    preserveXCloseFocus ||
    shouldPreserveMoviesDetailCloseButtonFocus({
      closeSource: detailCloseSourceRef.current,
      handoffActive: focusHandoffActive,
      naturalReturn:
        naturalReturnActive || shouldUseMoviesNaturalReturnPath(detailReturnPathRef.current),
    });
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
    !postRestoreActive &&
    backgroundTvFocusEnabled;
  const toolbarSearchPreferredAllowed = shouldAllowMoviesToolbarSearchPreferredFocus({
    detailPhase: detailFocusPhase,
    detailOpen,
    detailClosing,
    restoringBrowseFocus,
    postRestoreLatchActive: postRestoreActive,
    startupFocusOwnershipActive: startupFocusOwnershipActiveRef.current,
    playbackReturnRestoring: isRestoringPlaybackFocusRef.current,
  });

  // The toolbar and Sort control live in separate components. Resolve the two
  // toolbar handles after native attachment and only publish real changes so
  // the horizontal graph never depends on an unstable ref callback.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const searchHandle = searchToolbarRef.current ? findNodeHandle(searchToolbarRef.current) ?? undefined : undefined;
      const discoverHandle = discoverToolbarRef.current ? findNodeHandle(discoverToolbarRef.current) ?? undefined : undefined;
      setSearchToolbarFocusHandle((current) => current === searchHandle ? current : searchHandle);
      setDiscoverToolbarFocusHandle((current) => current === discoverHandle ? current : discoverHandle);
    });
    return () => cancelAnimationFrame(frame);
  }, [chromeFocusable, searchOpen]);
  const activeClosingFocusMovieId = resolveMoviesClosingFocusableMovieId({
    phase: detailFocusPhase,
    targetMovieId: closingFocusMovieId,
  });
  // Stage 4.2N fix: the V2 close path jumps straight to 'browse' (never a
  // legacy "closing" phase), so `activeClosingFocusMovieId` above always
  // resolves to null for it. `v2CloseFocusTargetId` is the V2-specific
  // override that forces the origin poster focusable/preferred in the exact
  // same render as the close transition — see its declaration for why this
  // is required instead of only deferring the imperative `.focus()` call.
  const effectiveClosingFocusMovieId = activeClosingFocusMovieId ?? v2CloseFocusTargetId;
  const postRestorePreferredMovieId = postRestoreActive ? postRestoreLatch!.restoredMovieId : null;
  const pinnedHighlightMovieId =
    postRestorePreferredMovieId ??
    effectiveClosingFocusMovieId ??
    (detailClosing ? closingFocusMovieId : null);
  const activeSnapshot = detailFocusTokenRef.current?.snapshot ?? browseFocusSnapshotRef.current;
  const snapshotTargetWasVisible = activeSnapshot
    ? wasMoviesSnapshotTargetVisible(activeSnapshot)
    : false;

  const setDetailVisualHoldSafe = useCallback((held: boolean) => {
    detailVisualHoldRef.current = held;
    setDetailVisualHold(held);
  }, []);

  const setVisualIsolationSafe = useCallback((active: boolean) => {
    visualIsolationRef.current = active;
    setVisualIsolationActive(active);
  }, []);

  /** Stage 4.2K.1: atomically clear every close-only visual flag. */
  const cleanupDetailCloseVisualState = useCallback(
    (input: { forced?: boolean; token?: string | null; reason?: string }) => {
      const forced = Boolean(input.forced);
      if (pendingIsolationFrameRef.current != null) {
        cancelAnimationFrame(pendingIsolationFrameRef.current);
        pendingIsolationFrameRef.current = null;
      }
      const hadIsolation = visualIsolationRef.current;
      const hadHold = detailVisualHoldRef.current;
      visualIsolationTokenRef.current = null;
      visualCoverTokenRef.current = null;
      setVisualIsolationSafe(false);
      setDetailVisualHoldSafe(false);
      if (isOnnMoviesTraceEnabled() && (hadIsolation || hadHold || forced)) {
        traceOnnMoviesEvent(
          'Overlay',
          forced ? 'detail_close_visual_state_cleanup_forced' : 'detail_close_visual_state_cleanup',
          {
            token: input.token ?? null,
            reason: input.reason ?? null,
            hadIsolation,
            hadHold,
            marker: MOVIES_FOCUS_STAGE4K1_MARKER,
          },
        );
      }
    },
    [setDetailVisualHoldSafe, setVisualIsolationSafe],
  );

  /** Stage 4.2K.2: cancel request-scoped confirm timer, retry RAF, and watchdog. */
  const clearCloseAttemptTimers = useCallback((opts?: { includeWatchdog?: boolean }) => {
    if (confirmTimeoutRef.current) {
      clearTimeout(confirmTimeoutRef.current);
      confirmTimeoutRef.current = null;
    }
    const attempt = focusAttemptRef.current;
    if (attempt?.retryRafId != null) {
      cancelAnimationFrame(attempt.retryRafId);
      focusAttemptRef.current = { ...attempt, retryRafId: null };
    }
    if (opts?.includeWatchdog !== false && closeWatchdogTimeoutRef.current) {
      clearTimeout(closeWatchdogTimeoutRef.current);
      closeWatchdogTimeoutRef.current = null;
    }
  }, []);

  const getImmutableCloseTargetMovieId = useCallback((): string | null => {
    return (
      immutableCloseTargetRef.current?.movieId ??
      closeTransactionRef.current?.targetMovieId ??
      detailFocusTokenRef.current?.snapshot.movieId ??
      null
    );
  }, []);

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
              : phase === 'return-focus-arming'
                ? 'return_focus_arming'
                : phase === 'return-focus-requested'
                ? 'return_focus_requested'
                : phase === 'return-focus-confirmed'
                  ? 'return_focus_confirmed'
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
        marker: MOVIES_FOCUS_STAGE4G_MARKER,
      });
    }
  }, [selectedCategoryId]);

  /**
   * Stage 4.2K.2: safely abort a stuck close — restore the same Detail movie,
   * clear isolation/handoff, and allow a fresh Back/X transaction.
   */
  const abortDetailCloseTransaction = useCallback(
    (input: { reason: string; token?: string | null }) => {
      const token =
        input.token ??
        closeTransactionRef.current?.token ??
        detailFocusTokenRef.current?.token ??
        null;
      const movieId =
        getImmutableCloseTargetMovieId() ??
        selectedMovie?.id ??
        null;
      const focusedControl =
        closeTransactionRef.current?.focusedDetailControl ??
        actualFocusedComponentRef.current ??
        null;

      clearCloseAttemptTimers({ includeWatchdog: true });
      for (const rafId of closeRafIdsRef.current) {
        cancelAnimationFrame(rafId);
      }
      closeRafIdsRef.current = [];

      if (closeTransactionRef.current && !closeTransactionRef.current.cancelled) {
        closeTransactionRef.current = {
          ...closeTransactionRef.current,
          cancelled: true,
        };
      }

      if (isOnnMoviesTraceEnabled()) {
        if (input.reason === 'watchdog') {
          traceOnnMoviesEvent('Overlay', 'detail_close_transaction_watchdog_expired', {
            token,
            movieId,
            elapsedMs: closeTransactionRef.current
              ? Date.now() - closeTransactionRef.current.startedAt
              : null,
            marker: MOVIES_FOCUS_STAGE4K2_MARKER,
          });
        }
        traceOnnMoviesEvent('Overlay', 'detail_close_transaction_aborted', {
          token,
          reason: input.reason,
          movieId,
          marker: MOVIES_FOCUS_STAGE4K2_MARKER,
        });
      }

      cleanupDetailCloseVisualState({
        forced: true,
        token,
        reason: `abort:${input.reason}`,
      });

      focusAttemptRef.current = null;
      focusConfirmationRef.current = null;
      focusConfirmedTokenRef.current = null;
      focusIssuedTokenRef.current = null;
      focusRetryCountRef.current = 0;
      focusRequestCountRef.current = 0;
      nativeFocusEnvironmentReadyRef.current = false;
      targetFocusConfirmedRef.current = false;
      detailFocusTokenRef.current = null;
      immutableCloseTargetRef.current = null;
      closeCommitTokenRef.current = null;
      closeTransactionRef.current = null;
      detailReturnPathRef.current = null;

      setClosingFocusMovieId(null);
      setRestoringBrowseFocus(false);
      setFocusSuppressionHeld(false);
      setPreserveXCloseFocus(false);
      xCloseActivationLockRef.current = resetMoviesDetailXCloseActivationLock(movieId);
      setXCloseActivationLocked(false);
      setViewportRestoreCommand(null);
      setLockScrollForFocusRestore(false);
      setDetailSuppressedForPlayback(false);
      // Keep Detail open on the same movie — exit closing-* permanently.
      detailOpenRef.current = true;
      setDetailOpen(true);
      setDetailFocusPhaseSafe('detail-open');

      if (isOnnMoviesTraceEnabled()) {
        traceOnnMoviesEvent('Overlay', 'detail_close_abort_restored_detail', {
          token,
          reason: input.reason,
          movieId,
          focusedDetailControl: focusedControl,
          detailFocusPhase: 'detail-open',
          visualIsolationActive: false,
          holdCoverActive: false,
          focusHandoffActive: false,
          marker: MOVIES_FOCUS_STAGE4K2_MARKER,
        });
      }
    },
    [
      cleanupDetailCloseVisualState,
      clearCloseAttemptTimers,
      getImmutableCloseTargetMovieId,
      selectedMovie?.id,
      setDetailFocusPhaseSafe,
    ],
  );

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
    console.info(
      '[NovaCast Movies Focus] ' +
        JSON.stringify({
          event: 'movies_detail_close_focus_owner_released',
          marker: MOVIES_FOCUS_STAGE4L1_MARKER,
          detailPhase: detailFocusPhaseRef.current,
          closeToken: latch.token,
          immutablePosterMovieId: latch.restoredMovieId,
          releaseReason: reason,
          postRestoreLatchActive: false,
        }),
    );
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
    // Stage 4.2J: after browse restoration latch, flush one consolidated deferred update.
    // Do not unfreeze on screen-change (Detail open) or unmount.
    if (reason !== 'screen-change' && reason !== 'unmount') {
      setMoviesBrowseUiFrozenForDetail(false);
      flushDeferredBrowseCommits();
    }
  }, [flushDeferredBrowseCommits]);

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

  /**
   * Stage 4.2L.2: close Detail and restore browse ownership when poster focus
   * cannot be requested safely. Prefer usability over exact poster restore.
   */
  const forceCompleteDetailCloseWithoutFocus = useCallback(
    (input: { token: string; movieId: string; reason: string }) => {
      const token = input.token;
      if (
        !closeTransactionRef.current ||
        closeTransactionRef.current.token !== token ||
        closeTransactionRef.current.revealCommitted ||
        closeTransactionRef.current.cancelled
      ) {
        return;
      }
      clearCloseAttemptTimers({ includeWatchdog: true });
      for (const rafId of closeRafIdsRef.current) {
        cancelAnimationFrame(rafId);
      }
      closeRafIdsRef.current = [];
      closeTransactionRef.current = {
        ...closeTransactionRef.current,
        revealCommitted: true,
      };
      closeCommitTokenRef.current = token;
      cleanupDetailCloseVisualState({
        forced: true,
        token,
        reason: `focus-failed:${input.reason}`,
      });
      focusAttemptRef.current = null;
      focusConfirmationRef.current = null;
      focusConfirmedTokenRef.current = token;
      focusIssuedTokenRef.current = null;
      nativeFocusEnvironmentReadyRef.current = false;
      targetFocusConfirmedRef.current = true;
      detailFocusTokenRef.current = null;
      immutableCloseTargetRef.current = null;
      detailReturnPathRef.current = null;
      setClosingFocusMovieId(null);
      setRestoringBrowseFocus(false);
      setFocusSuppressionHeld(false);
      setPreserveXCloseFocus(false);
      setViewportRestoreCommand(null);
      setLockScrollForFocusRestore(false);
      setDetailSuppressedForPlayback(false);
      setDetailVisualHoldSafe(false);
      setVisualIsolationSafe(false);
      detailOpenRef.current = false;
      setDetailOpen(false);
      setDetailFocusPhaseSafe('browse-restored');
      activatePostRestoreLatch(token, input.movieId);
      console.info(
        '[NovaCast Movies Focus] ' +
          JSON.stringify({
            event: 'movies_detail_return_focus_fallback_browse',
            marker: MOVIES_FOCUS_STAGE4L2_MARKER,
            token,
            movieId: input.movieId,
            reason: input.reason,
          }),
      );
    },
    [
      activatePostRestoreLatch,
      cleanupDetailCloseVisualState,
      clearCloseAttemptTimers,
      setDetailFocusPhaseSafe,
      setDetailVisualHoldSafe,
      setVisualIsolationSafe,
    ],
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

  // Stage 4.2L.1: startup focus is strictly one-shot per provider route session.
  const startupFocusRequestedRef = useRef(false);
  useEffect(() => {
    if (!startupInteractive || startupFocusRequestedRef.current) {
      return;
    }
    if (detailOpen || detailClosing || restoringBrowseFocus) {
      return;
    }
    const targetMovieId = getFocusedMovieId();
    if (!targetMovieId) {
      return;
    }
    startupFocusRequestedRef.current = true;
    startupFocusOwnershipActiveRef.current = true;
    console.info(
      '[NovaCast Movies Startup] ' +
        JSON.stringify({
          event: 'movies_startup_focus_request_started',
          marker: MOVIES_FOCUS_STAGE4L1_MARKER,
          movieId: targetMovieId,
          selectedCategoryId,
        }),
    );
    if (startupFocusFrameRef.current != null) {
      cancelAnimationFrame(startupFocusFrameRef.current);
    }
    startupFocusFrameRef.current = requestAnimationFrame(() => {
      startupFocusFrameRef.current = null;
      console.info(
        '[NovaCast Movies Startup] ' +
          JSON.stringify({
            event: 'movies_startup_focus_confirmed',
            marker: MOVIES_FOCUS_STAGE4L1_MARKER,
            movieId: targetMovieId,
            selectedCategoryId,
          }),
      );
      const released = releaseMoviesStartupFocusOwnership(activeProviderId);
      startupFocusOwnershipActiveRef.current = false;
      console.info(
        '[NovaCast Movies Startup] ' +
          JSON.stringify({
            event: 'movies_startup_focus_ownership_released',
            marker: MOVIES_FOCUS_STAGE4L1_MARKER,
            movieId: targetMovieId,
            released: released.released,
            startupSessionId: released.session?.sessionId ?? null,
          }),
      );
    });
    return () => {
      if (startupFocusFrameRef.current != null) {
        cancelAnimationFrame(startupFocusFrameRef.current);
        startupFocusFrameRef.current = null;
      }
    };
  }, [
    activeProviderId,
    detailClosing,
    detailOpen,
    getFocusedMovieId,
    restoringBrowseFocus,
    selectedCategoryId,
    startupInteractive,
  ]);

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
    const resumePromptOpenNow = isPlaybackResumePromptOpen();
    if (shouldIgnoreMoviesRemoteInput(resumePromptOpenNow)) {
      logResumeInputAudit({
        eventType: event.eventType,
        resumePromptOpen: true,
        moviesRemoteHandlerReceived: true,
        categoryHandlerReceived: false,
        categoryIndexBefore: selectedCategoryId,
        categoryIndexAfter: selectedCategoryId,
      });
      return;
    }
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
      if (confirmTimeoutRef.current) {
        clearTimeout(confirmTimeoutRef.current);
        confirmTimeoutRef.current = null;
      }
      if (closeWatchdogTimeoutRef.current) {
        clearTimeout(closeWatchdogTimeoutRef.current);
        closeWatchdogTimeoutRef.current = null;
      }
      if (focusAttemptRef.current?.retryRafId != null) {
        cancelAnimationFrame(focusAttemptRef.current.retryRafId);
      }
      focusAttemptRef.current = null;
      focusConfirmationRef.current = null;
      immutableCloseTargetRef.current = null;
      if (pendingIsolationFrameRef.current != null) {
        cancelAnimationFrame(pendingIsolationFrameRef.current);
        pendingIsolationFrameRef.current = null;
      }
      for (const rafId of closeRafIdsRef.current) {
        cancelAnimationFrame(rafId);
      }
      closeRafIdsRef.current = [];
      visualIsolationRef.current = false;
      detailVisualHoldRef.current = false;
      visualIsolationTokenRef.current = null;
      visualCoverTokenRef.current = null;
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
      resetMoviesBrowsePresentationLatches();
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

  // Stage 4.2K.1: category rail visibility invariant (browse restored).
  useEffect(() => {
    if (!isOnnMoviesTraceEnabled()) {
      return;
    }
    const closeFinished =
      !closeTransactionRef.current || Boolean(closeTransactionRef.current.revealCommitted);
    const visualCleanupFinished = !visualIsolationActive && !focusHandoffActive;
    const railExpectedVisible = isMoviesCategoryRailExpectedVisible({
      moviesRouteActive: true,
      categoryCount: categories.length,
      detailOpen: detailOpen || detailClosing,
      searchClosed: !searchOpen,
      playbackInactive: !playbackActive && !launchingPlayback,
      playbackClosing,
      closeTransactionFinished: closeFinished,
      visualCleanupFinished,
    });
    const browseOpacity = playbackUiActive ? 0 : 1;
    const overlayOpacity = detailOverlayVisible || visualIsolationActive ? 1 : 0;
    const payload = {
      categoryCount: categories.length,
      selectedCategoryId,
      detailOpen: detailOpen || detailClosing,
      detailFocusPhase,
      visualIsolationActive,
      holdCoverActive: focusHandoffActive,
      focusHandoffActive,
      overlayVisible: detailOverlayVisible,
      shellVisible: detailOverlayVisible || visualIsolationActive,
      railExpectedVisible,
      railContainerWidth: railExpectedVisible ? MOVIES_CATEGORY_RAIL_WIDTH : 0,
      browseOpacity,
      overlayOpacity,
      isolationCoverMounted: visualIsolationActive,
      transactionToken: closeTransactionRef.current?.token ?? null,
      railInstanceId: railInstanceIdRef.current,
      marker: MOVIES_FOCUS_STAGE4K1_MARKER,
    };
    traceOnnMoviesEvent('Overlay', 'movies_category_rail_visual_state', payload);
    if (
      isMoviesCategoryRailVisibilityViolation({
        railExpectedVisible,
        visualIsolationActive,
        holdCoverActive: focusHandoffActive,
        focusHandoffActive,
        overlayVisible: detailOverlayVisible,
        isolationCoverMounted: visualIsolationActive,
        railContainerWidth: payload.railContainerWidth,
        browseOpacity,
        overlayOpacity,
      })
    ) {
      traceOnnMoviesEvent('Overlay', 'movies_category_rail_visibility_violation', payload);
    }
  }, [
    categories.length,
    detailClosing,
    detailFocusPhase,
    detailOpen,
    detailOverlayVisible,
    focusHandoffActive,
    launchingPlayback,
    playbackActive,
    playbackClosing,
    playbackUiActive,
    searchOpen,
    selectedCategoryId,
    visualIsolationActive,
  ]);

  const completeDetailFocusRestore = useCallback(
    (movieId: string, highlightVisible: boolean) => {
      const token = detailFocusTokenRef.current;
      const snapshot = token?.snapshot ?? browseFocusSnapshotRef.current;
      if (!token || !snapshot) {
        return false;
      }

      // Stage 4.2K.2: confirm against immutable transaction target only.
      const targetMovieId =
        getImmutableCloseTargetMovieId() ?? snapshot.movieId;
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
      const matchingFocus = highlightVisible && movieId === targetMovieId;
      if (matchingFocus) {
        if (
          !shouldAcceptMoviesDetailCloseFocusConfirmation({
            token: token.token,
            confirmedToken: focusConfirmedTokenRef.current,
            movieId,
            targetMovieId,
          })
        ) {
          if (focusConfirmedTokenRef.current === token.token) {
            if (isOnnMoviesTraceEnabled()) {
              traceOnnMoviesEvent('Focus', 'detail_close_duplicate_focus_confirmation_dropped', {
                token: token.token,
                movieId,
                marker: MOVIES_FOCUS_STAGE4K_MARKER,
              });
            }
            // Still allow offset-stable completion after first confirmation.
            if (!viewportStable) {
              return false;
            }
          } else {
            return false;
          }
        } else {
          const attemptBeforeClear = focusAttemptRef.current;
          const retryCountBeforeClear = focusRetryCountRef.current;
          const late = Boolean(
            attemptBeforeClear &&
              (attemptBeforeClear.retryRafId != null ||
                retryCountBeforeClear > 0 ||
                (attemptBeforeClear.confirmationDeadline != null &&
                  attemptBeforeClear.requestSettledAt != null &&
                  Date.now() >=
                    attemptBeforeClear.requestSettledAt + MOVIES_DETAIL_FOCUS_CONFIRM_TIMEOUT_MS)),
          );
          focusConfirmedTokenRef.current = token.token;
          targetFocusConfirmedRef.current = true;
          focusConfirmationRef.current = {
            token: token.token,
            movieId,
            acceptedAt: Date.now(),
            late,
          };
          // Stage 4.2K.1/K.2: cancel confirmation timeout + scheduled retry immediately.
          clearCloseAttemptTimers({ includeWatchdog: false });
          if (late && isOnnMoviesTraceEnabled()) {
            traceOnnMoviesEvent('Focus', 'detail_close_late_matching_focus_accepted', {
              token: token.token,
              movieId,
              attemptNumber: attemptBeforeClear?.attemptNumber ?? null,
              retryScheduled: retryCountBeforeClear > 0 || attemptBeforeClear?.retryRafId != null,
              marker: MOVIES_FOCUS_STAGE4K2_MARKER,
            });
          }
          if (isOnnMoviesTraceEnabled()) {
            traceOnnMoviesEvent('Focus', 'detail_close_poster_focus_confirmed', {
              token: token.token,
              source: detailCloseSourceRef.current,
              origin: closeTransactionRef.current?.origin ?? 'browse',
              movieId,
              offset: currentOffset,
              gridInstanceId: getOnnMoviesGridInstanceId(),
              marker: MOVIES_FOCUS_STAGE4K_MARKER,
            });
          }
          if (closeTransactionRef.current) {
            closeTransactionRef.current = {
              ...closeTransactionRef.current,
              focusConfirmed: true,
              offsetConfirmed: viewportStable,
            };
          }
        }
      } else {
        targetFocusConfirmedRef.current = false;
      }

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
            marker: MOVIES_FOCUS_STAGE4G_MARKER,
          });
        }
        if (viewportRestoreCountRef.current < maxRestores) {
          // Stage 4.2K: corrective scroll must stay under visual isolation.
          if (
            isMoviesDetailCloseCorrectionUncovered({
              visualIsolationActive: visualIsolationRef.current,
              visualHoldActive: detailVisualHoldRef.current,
            })
          ) {
            if (isOnnMoviesTraceEnabled()) {
              traceOnnMoviesEvent('Overlay', 'detail_close_uncovered_correction_violation', {
                token: token.token,
                movieId,
                marker: MOVIES_FOCUS_STAGE4K_MARKER,
              });
            }
            setDetailVisualHoldSafe(true);
            setVisualIsolationSafe(true);
          }
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
              visualHoldActive: detailVisualHoldRef.current,
              visualIsolationActive: visualIsolationRef.current,
              marker: MOVIES_FOCUS_STAGE4K_MARKER,
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
                  marker: MOVIES_FOCUS_STAGE4G_MARKER,
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

      const naturalReturn = shouldUseMoviesNaturalReturnPath(detailReturnPathRef.current);
      const confirmPhase: MoviesDetailFocusPhase = naturalReturn
        ? 'return-focus-confirmed'
        : 'closing-confirm';

      logMoviesDetailFocusLifecycle({
        token: token.token,
        phase: confirmPhase,
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
        phase: confirmPhase,
        targetMovieId,
        targetIndex: movieIndex,
        snapshotOffset: snapshot.verticalOffset,
        currentOffset,
        offsetDelta,
        targetRelativeRow: snapshot.targetRelativeRow,
        snapshotTargetWasVisible: snapshotWasVisible,
        initialRestoreIssued: !naturalReturn && viewportRestoreCountRef.current >= 1,
        correctiveRestoreIssued: viewportRestoreCountRef.current >= (naturalReturn ? 1 : 2),
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
      setDetailFocusPhaseSafe(confirmPhase);

      const finishReveal = () => {
        // Stage 4.2J: strict ownership — null or mismatched token drops immediately.
        if (
          shouldDropMoviesDetailCloseCallback({
            activeToken: detailFocusTokenRef.current?.token,
            callbackToken: token.token,
            revealCommitted: closeTransactionRef.current?.revealCommitted,
            commitToken: closeCommitTokenRef.current,
          })
        ) {
          if (isOnnMoviesTraceEnabled()) {
            traceOnnMoviesEvent('Overlay', 'detail_close_stale_callback_dropped', {
              token: token.token,
              activeToken: detailFocusTokenRef.current?.token ?? null,
              commitToken: closeCommitTokenRef.current,
              marker: MOVIES_FOCUS_STAGE4J_MARKER,
            });
          }
          return;
        }
        if (closeCommitTokenRef.current === token.token) {
          if (isOnnMoviesTraceEnabled()) {
            traceOnnMoviesEvent('Overlay', 'detail_close_duplicate_commit_blocked', {
              token: token.token,
              marker: MOVIES_FOCUS_STAGE4J_MARKER,
            });
          }
          return;
        }
        const commit = tryCommitMoviesDetailCloseReveal({
          transaction: closeTransactionRef.current,
          token: token.token,
        });
        if (!commit.ok) {
          if (isOnnMoviesTraceEnabled()) {
            traceOnnMoviesEvent('Overlay', 'detail_close_duplicate_commit_blocked', {
              token: token.token,
              reason: commit.reason,
              marker: MOVIES_FOCUS_STAGE4J_MARKER,
            });
          }
          return;
        }
        // Commit token before any overlay state mutation — one reveal only.
        closeCommitTokenRef.current = token.token;
        closeTransactionRef.current = commit.transaction;
        for (const rafId of closeRafIdsRef.current) {
          cancelAnimationFrame(rafId);
        }
        closeRafIdsRef.current = [];
        // Stage 4.2K.2: clear request timer + watchdog — transaction succeeded.
        clearCloseAttemptTimers({ includeWatchdog: true });
        focusAttemptRef.current = null;
        immutableCloseTargetRef.current = null;

        const correctionCount = viewportRestoreCountRef.current;
        const closeSource = detailCloseSourceRef.current;
        const posterFocusConfirmed =
          targetFocusConfirmedRef.current &&
          movieId === targetMovieId &&
          actualFocusedComponentRef.current === 'MoviePosterCard';
        if (
          closeSource === 'x' &&
          (!posterFocusConfirmed || actualFocusedComponentRef.current !== 'MoviePosterCard')
        ) {
          if (isOnnMoviesTraceEnabled()) {
            traceOnnMoviesEvent('Focus', 'detail_x_focus_violation', {
              reason: 'reveal-without-poster-focus',
              actualFocusedComponent: actualFocusedComponentRef.current,
              intendedMovieId: targetMovieId,
              token: token.token,
              marker: MOVIES_FOCUS_STAGE4H_MARKER,
            });
          }
        }
        if (isOnnMoviesTraceEnabled()) {
          traceOnnMoviesEvent('Overlay', 'detail_close_commit_once', {
            token: token.token,
            source: closeSource,
            origin: closeTransactionRef.current?.origin ?? 'browse',
            movieId,
            offset: viewportStateRef.current.offset,
            elapsedMs: Date.now() - (closeTransactionRef.current?.startedAt ?? Date.now()),
            listRevision: closeTransactionRef.current?.listRevision ?? null,
            marker: MOVIES_FOCUS_STAGE4J_MARKER,
          });
        }
        if (closeSource === 'x' && isOnnMoviesTraceEnabled()) {
          traceOnnMoviesEvent('Overlay', 'detail_x_focus_owner_released', {
            posterFocusConfirmed: true,
            hiddenHandoffFocused: false,
            token: token.token,
            marker: MOVIES_FOCUS_STAGE4H_MARKER,
          });
        }
        // Stage 4.2H/K.1: release focus owner; keep isolation cover until browse+rail confirm.
        setPreserveXCloseFocus(false);
        xCloseActivationLockRef.current = resetMoviesDetailXCloseActivationLock();
        setXCloseActivationLocked(false);
        // Drop card paint; isolation cover alone hides residual layout work.
        if (detailVisualHoldRef.current && isOnnMoviesTraceEnabled()) {
          traceOnnMoviesEvent('Overlay', 'detail_visual_hold_released', {
            token: token.token,
            focusConfirmed: true,
            offsetConfirmed: true,
            finalOffset: viewportStateRef.current.offset,
            correctionCount,
            marker: MOVIES_FOCUS_STAGE4G_MARKER,
          });
        }
        setDetailVisualHoldSafe(false);
        detailFocusTokenRef.current = null;
        focusIssuedTokenRef.current = null;
        nativeFocusEnvironmentReadyRef.current = false;
        isRestoringPlaybackFocusRef.current = false;
        setRestoringBrowseFocus(false);
        // Keep closingFocusMovieId until latch owns preferred/highlight pin.
        browseFocusSnapshotRef.current = createMoviesBrowseFocusSnapshot({
          ...snapshot,
          movieId,
          movieIndex,
          columns: getSeriesPosterColumns(width),
        });

        // Hide overlay panel after focus + offset confirm; isolation stays one more frame.
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
          currentOffset: viewportStateRef.current.offset,
          scrollIssued: scrollIssuedTokenRef.current === token.token,
          focusIssued: true,
          actuallyFocusedMovieId: movieId,
          highlightVisible: true,
          overlayMounted: false,
        });
        if (isOnnMoviesTraceEnabled()) {
          const returnPath = detailReturnPathRef.current;
          traceOnnMoviesEvent('Focus', 'focus_confirmed', {
            movieId,
            offset: viewportStateRef.current.offset,
            gridInstanceId: getOnnMoviesGridInstanceId(),
            returnPath,
          });
          traceOnnMoviesScrollSample('post-poster-focus', { offset: viewportStateRef.current.offset }, true);
          traceOnnMoviesEvent('Overlay', 'browse_reveal', {
            finalOffset: viewportStateRef.current.offset,
            focusConfirmed: true,
            correctionCount,
            userVisibleMovementExpected: false,
            returnPath,
            token: token.token,
            marker: MOVIES_FOCUS_STAGE4G_MARKER,
          });
          traceOnnMoviesEvent('Overlay', 'detail_close_browse_revealed', {
            token: token.token,
            source: closeSource,
            origin: 'browse',
            movieId,
            offset: viewportStateRef.current.offset,
            gridInstanceId: getOnnMoviesGridInstanceId(),
            elapsedMs: Date.now() - (closeTransactionRef.current?.startedAt ?? Date.now()),
            marker: MOVIES_FOCUS_STAGE4J_MARKER,
          });
          traceOnnMoviesEvent('Overlay', 'browse_restored', {
            movieId,
            offset: viewportStateRef.current.offset,
            gridInstanceId: getOnnMoviesGridInstanceId(),
            returnPath,
          });
          traceOnnMoviesEvent('Overlay', 'overlay_unmounted', {
            movieId,
            offset: viewportStateRef.current.offset,
          });
          traceOnnMoviesEvent('Overlay', 'detail_close_transaction_finished', {
            token: token.token,
            source: closeSource,
            origin: 'browse',
            movieId,
            elapsedMs: Date.now() - (closeTransactionRef.current?.startedAt ?? Date.now()),
            marker: MOVIES_FOCUS_STAGE4J_MARKER,
          });
          traceOnnMoviesScrollSample('post-restore-latch', { offset: viewportStateRef.current.offset }, true);
        }
        closeTransactionRef.current = null;
        detailReturnPathRef.current = null;
        console.info(
          '[NovaCast Movies Restore Polish] ' +
            JSON.stringify({
              marker: naturalReturn ? MOVIES_FOCUS_STAGE4G_MARKER : MOVIES_FOCUS_STAGE3D3_MARKER,
              token: token.token,
            }),
        );
        activatePostRestoreLatch(token.token, movieId);
        releaseFocusSuppressionAfterStabilize(token.token);
        setTimeout(() => {
          setClosingFocusMovieId(null);
        }, MOVIES_FOCUS_SUPPRESSION_RELEASE_MS + 16);

        // Stage 4.2K.1: release isolation only after one committed frame confirms
        // poster focus + offset + browse layout + category rail visible-state.
        const releaseIsolationFrame = requestAnimationFrame(() => {
          pendingIsolationFrameRef.current = null;
          const browseLayoutConfirmed = !detailOpenRef.current;
          // Rail layout identity confirmed (categories present, browse open) —
          // isolation cover is still up; release itself is the cleanup step.
          const railLayoutConfirmed =
            categories.length > 0 && browseLayoutConfirmed;
          const mayReleaseIsolation = shouldReleaseMoviesDetailVisualIsolation({
            focusConfirmed: true,
            movieIdConfirmed: movieId === targetMovieId,
            offsetConfirmed: true,
            correctiveScrollPending: false,
            browseLayoutConfirmed,
            railVisibleConfirmed: railLayoutConfirmed,
          });
          if (isOnnMoviesTraceEnabled() && visualIsolationRef.current && mayReleaseIsolation) {
            traceOnnMoviesEvent('Overlay', 'detail_close_visual_isolation_released', {
              token: token.token,
              source: closeSource,
              movieId,
              offset: viewportStateRef.current.offset,
              elapsedMs: Date.now() - overlayRemovedAt,
              marker: MOVIES_FOCUS_STAGE4K_MARKER,
            });
          }
          if (mayReleaseIsolation || visualIsolationRef.current) {
            cleanupDetailCloseVisualState({
              forced: !mayReleaseIsolation,
              token: token.token,
              reason: mayReleaseIsolation ? 'browse-rail-confirmed' : 'forced-after-commit',
            });
          }
        });
        pendingIsolationFrameRef.current = releaseIsolationFrame;
        closeRafIdsRef.current.push(releaseIsolationFrame);
      };

      // Stage 4.2G/J/K.1: one rendered frame after confirmation before browse reveal.
      // Fallback also holds isolation, so always wait a committed frame.
      if (naturalReturn || detailVisualHoldRef.current || visualIsolationRef.current) {
        const outer = requestAnimationFrame(() => {
          const inner = requestAnimationFrame(finishReveal);
          closeRafIdsRef.current.push(inner);
        });
        closeRafIdsRef.current.push(outer);
      } else {
        finishReveal();
      }
      return true;
    },
    [
      activatePostRestoreLatch,
      categories.length,
      cleanupDetailCloseVisualState,
      clearCloseAttemptTimers,
      getImmutableCloseTargetMovieId,
      launchingPlayback,
      playbackActive,
      playbackClosing,
      releaseFocusSuppressionAfterStabilize,
      setDetailFocusPhaseSafe,
      setDetailVisualHoldSafe,
      visibleMovies,
      width,
    ],
  );

  const handleFocusMovie = useCallback(
    (movie: { id: string }) => {
      if (playbackUiActive || Date.now() < playFocusGuardUntilRef.current) {
        return;
      }
      const immutableTargetId = getImmutableCloseTargetMovieId();
      if (isOnnMoviesTraceEnabled()) {
        const targetId = immutableTargetId;
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
        const tx = closeTransactionRef.current;
        const lateOk = shouldAcceptMoviesDetailCloseLateFocus({
          token: detailFocusTokenRef.current?.token ?? '',
          activeToken: detailFocusTokenRef.current?.token ?? null,
          movieId: movie.id,
          immutableMovieId: immutableTargetId,
          gridInstanceId: immutableCloseTargetRef.current?.gridInstanceId ?? null,
          activeGridInstanceId: getOnnMoviesGridInstanceId(),
          revealCommitted: Boolean(tx?.revealCommitted),
          cancelled: Boolean(tx?.cancelled),
        });
        if (!lateOk) {
          if (immutableTargetId && movie.id !== immutableTargetId) {
            logMoviesDetailFocusConflict({
              token: detailFocusTokenRef.current?.token ?? null,
              phase,
              winningComponent: 'MoviePosterCard',
              targetMovieId: immutableTargetId,
              actuallyFocusedMovieId: movie.id,
              reason: 'non-target-poster-during-close',
            });
          }
          // Stage 4.2K.2: never retarget / never retry for a wrong poster.
          return;
        }
        // Matching immutable target — cancel timeout + retry even at the boundary.
        clearCloseAttemptTimers({ includeWatchdog: false });
        if (restoreTimingRef.current && restoreTimingRef.current.focusConfirmedAt == null) {
          restoreTimingRef.current.focusConfirmedAt = Date.now();
        }
        if (detailCloseSourceRef.current === 'x' && isOnnMoviesTraceEnabled()) {
          traceOnnMoviesEvent('Focus', 'detail_x_poster_focus_confirmed', {
            targetMovieId: movie.id,
            finalOffset: viewportStateRef.current.offset,
            token: detailFocusTokenRef.current?.token ?? null,
            marker: MOVIES_FOCUS_STAGE4H_MARKER,
          });
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
      clearCloseAttemptTimers,
      completeDetailFocusRestore,
      focusMovie,
      getImmutableCloseTargetMovieId,
      playbackUiActive,
      releasePostRestoreLatch,
      selectedCategoryId,
      visibleMovies,
      width,
    ],
  );

  const handleSelectMovie = useCallback(
    (movie: Parameters<typeof selectMovie>[0], origin: 'browse' | typeof DISCOVERY_ZONE_ORIGIN = 'browse') => {
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
        listRevision: getMoviesBrowseListRevision(),
      };
      setDetailSource('browse');
      detailSourceRef.current = 'browse';
      detailLaunchOriginRef.current = origin;
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
      // Stage 4.2J/K: new Detail open resets commit ownership and freezes browse UI commits.
      closeCommitTokenRef.current = null;
      closeTransactionRef.current = null;
      focusConfirmedTokenRef.current = null;
      nativeFocusEnvironmentReadyRef.current = false;
      focusRetryCountRef.current = 0;
      setMoviesBrowseUiFrozenForDetail(true);
      setDetailOpen(true);
      setDetailFocusPhaseSafe('detail-open');
      // Stage 4.2N — MovieDetailPopupV2's own simple state. No close phases,
      // no isolation/hold-cover, no X-close activation lock.
      detailPopupOpenRef.current = true;
      setDetailPopup({ open: true, movie, originItemId: movie.id });
      // Stage 4.2N fix: clear any stale force-focusable target from a prior
      // close so it can never keep the wrong poster focusable once a new
      // popup opens for a different movie.
      setV2CloseFocusTargetId(null);
      logMovieDetailPopupV2Event('movie_detail_popup_v2_active', {
        movieId: movie.id,
        origin,
      });
      if (shouldReturnToDiscoverZone(origin)) {
        logDiscoverZoneDetailOpen({
          mediaType: 'movie',
          itemId: movie.id,
          origin: DISCOVERY_ZONE_ORIGIN,
        });
      }
      if (isOnnMoviesTraceEnabled()) {
        const snap = browseFocusSnapshotRef.current;
        traceOnnMoviesEvent('Overlay', 'detail_close_browse_frozen', {
          movieId: movie.id,
          listRevision: getMoviesBrowseListRevision(),
          marker: MOVIES_FOCUS_STAGE4J_MARKER,
        });
        traceOnnMoviesEvent('Overlay', 'detail_open', {
          movieId: movie.id,
          categoryId: selectedCategoryId,
          renderedIndex: snap?.movieIndex ?? null,
          listOffset: snap?.verticalOffset ?? viewportStateRef.current.offset,
          firstVisibleIndex: snap?.visibleFirstIndex ?? null,
          lastVisibleIndex: snap?.visibleLastIndex ?? null,
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
      logMoviesDetailV2FocusOwnership({
        phase: 'detail-open',
        movieId: movie.id,
        detailOpen: true,
        focusIssued: false,
        detailCtaHandlePresent: false,
        focusedRegion: 'detail',
        categoryHostFocusable: false,
        posterHostFocusable: false,
      });
      logMoviesDetailV2FocusOwnership({
        phase: 'background-focus-disabled',
        movieId: movie.id,
        detailOpen: true,
        focusIssued: false,
        detailCtaHandlePresent: false,
        focusedRegion: 'detail',
        categoryHostFocusable: false,
        posterHostFocusable: false,
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
      if (
        (phase === 'closing-viewport' ||
          phase === 'closing-focus' ||
          phase === 'return-focus-requested' ||
          phase === 'return-focus-confirmed') &&
        token
      ) {
        const stable = isMoviesViewportOffsetStable({
          currentOffset: state.offset,
          snapshotOffset: token.snapshot.verticalOffset,
          tolerancePx: MOVIES_VIEWPORT_OFFSET_TOLERANCE_PX,
        });
        if (stable) {
          // Kick the close driver to advance / re-confirm once offset matches snapshot.
          setRestorationRetry((value) => value + 1);
        } else if (
          (phase === 'closing-focus' || phase === 'return-focus-requested') &&
          targetFocusConfirmedRef.current
        ) {
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
      if (isNovaCastTraceLoggingEnabled()) {
        console.info('[NovaCast Movie Poster Ref]', {
          action: 'register',
          contentId: movieId,
          instanceToken,
          nativeTag: findNodeHandle(instance) ?? null,
          renderedIndex,
        });
      }
      return;
    }

    const stored = posterRefs.current.get(movieId);
    if (stored?.instanceToken === instanceToken) {
      posterRefs.current.delete(movieId);
      if (isNovaCastTraceLoggingEnabled()) {
        console.info('[NovaCast Movie Poster Ref]', {
          action: 'unregister',
          contentId: movieId,
          instanceToken,
          nativeTag: stored.instance ? findNodeHandle(stored.instance) ?? null : null,
          renderedIndex,
        });
      }
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
      if (isNovaCastTraceLoggingEnabled()) {
        console.info('[NovaCast Movie Poster Ref]', {
          action: 'request',
          contentId,
          instanceToken: stored?.instanceToken ?? null,
          nativeTag: stored?.instance ? findNodeHandle(stored.instance) ?? null : null,
          renderedIndex: stored?.renderedIndex ?? targetIndex ?? null,
        });
      }
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
    if (resumePromptOpen) {
      if (!resumeBackgroundFocusLoggedRef.current) {
        resumeBackgroundFocusLoggedRef.current = true;
        logResumeFocus('background-focus-disabled', { dialogOpen: true });
      }
      return;
    }
    if (resumeBackgroundFocusLoggedRef.current) {
      resumeBackgroundFocusLoggedRef.current = false;
      logResumeFocus('background-focus-restored', { dialogOpen: false });
    }
  }, [resumePromptOpen]);

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
      // Stage 4.2N: MovieDetailPopupV2 never calls this legacy multi-phase
      // close initiator. If it is ever reached while the V2 popup owns the
      // close path, that is a forbidden violation — log it loudly.
      if (detailPopupOpenRef.current) {
        logMovieDetailLegacyClosePathViolation({ source, from: 'beginDetailFocusClose' });
      }
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

      if (closeTransactionRef.current && !closeTransactionRef.current.revealCommitted) {
        if (isOnnMoviesTraceEnabled()) {
          traceOnnMoviesEvent('Overlay', 'detail_close_transaction_violation', {
            reason: 'concurrent-close',
            activeToken: closeTransactionRef.current.token,
            marker: MOVIES_FOCUS_STAGE4J_MARKER,
          });
        }
        return false;
      }

      const token = `${source === 'detail-close' ? 'detail' : 'playback'}-${++restorationSequenceRef.current}`;
      const openContext = detailOpenContextRef.current;
      const stored = posterRefs.current.get(snapshot.movieId);
      const targetInstance = getValidatedPosterTarget(
        snapshot.movieId,
        snapshot.movieIndex >= 0 ? snapshot.movieIndex : undefined,
      );
      const targetNativeHandleExists = Boolean(targetInstance);
      const snapshotWasVisible = wasMoviesSnapshotTargetVisible(snapshot);
      const listRevision = getMoviesBrowseListRevision();
      const openBrowseListRevision = openContext?.listRevision ?? listRevision;
      const visibleEntryMatches = visibleMovies[snapshot.movieIndex]?.id === snapshot.movieId;
      const targetRefValid = isMoviesDetailCloseTargetRefValid({
        hasSnapshot: true,
        targetMovieId: snapshot.movieId,
        targetIndex: snapshot.movieIndex,
        targetNativeHandleExists,
        registeredContentIdMatches: stored?.contentId === snapshot.movieId,
        registeredIndexMatches:
          snapshot.movieIndex < 0 || stored?.renderedIndex === snapshot.movieIndex,
        gridInstanceMatches:
          !openContext?.gridInstanceId ||
          openContext.gridInstanceId === getOnnMoviesGridInstanceId(),
        visibleMoviesEntryMatches: visibleEntryMatches,
        snapshotTargetWasVisible: snapshotWasVisible,
        listRevisionUnchanged: openBrowseListRevision === listRevision,
      });
      if (isOnnMoviesTraceEnabled()) {
        traceOnnMoviesEvent(
          'Focus',
          targetRefValid ? 'detail_close_target_ref_validated' : 'detail_close_target_ref_invalid',
          {
            token,
            movieId: snapshot.movieId,
            nativeHandle: targetInstance ? findNodeHandle(targetInstance) : null,
            gridInstanceId: getOnnMoviesGridInstanceId(),
            offset: snapshot.verticalOffset,
            listRevision,
            snapshotTargetWasVisible: snapshotWasVisible,
            marker: MOVIES_FOCUS_STAGE4J_MARKER,
          },
        );
      }
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
        snapshotTargetWasVisible: snapshotWasVisible,
        targetRefIdentityValid: targetRefValid,
        listRevisionUnchanged: openBrowseListRevision === listRevision,
      });
      detailReturnPathRef.current = returnPath;
      closeCommitTokenRef.current = null;
      const startedAt = Date.now();
      const targetNativeHandle = targetInstance ? findNodeHandle(targetInstance) : null;
      const immutableTarget = createMoviesDetailCloseImmutableTarget({
        token,
        source: detailCloseSourceRef.current,
        origin: 'browse',
        movieId: snapshot.movieId,
        categoryId: snapshot.categoryId,
        renderedIndex: snapshot.movieIndex,
        nativeHandle: targetNativeHandle,
        gridInstanceId: getOnnMoviesGridInstanceId(),
        listRevision: openBrowseListRevision,
        originalOffset: snapshot.verticalOffset,
        firstVisibleIndex: snapshot.visibleFirstIndex,
        lastVisibleIndex: snapshot.visibleLastIndex,
        targetVisible: snapshotWasVisible,
      });
      immutableCloseTargetRef.current = immutableTarget;
      focusAttemptRef.current = null;
      focusConfirmationRef.current = null;
      closeTransactionRef.current = createMoviesDetailCloseTransaction({
        token,
        source: detailCloseSourceRef.current,
        origin: 'browse',
        targetMovieId: snapshot.movieId,
        targetIndex: snapshot.movieIndex,
        categoryId: snapshot.categoryId,
        gridInstanceId: getOnnMoviesGridInstanceId(),
        listOffset: snapshot.verticalOffset,
        focusedDetailControl: actualFocusedComponentRef.current,
        targetNativeHandle,
        startedAt,
        listRevision: openBrowseListRevision,
        snapshotTargetWasVisible: snapshotWasVisible,
      });
      if (isOnnMoviesTraceEnabled()) {
        traceOnnMoviesEvent('Overlay', 'detail_close_transaction_started', {
          token,
          source: detailCloseSourceRef.current,
          origin: 'browse',
          movieId: snapshot.movieId,
          gridInstanceId: getOnnMoviesGridInstanceId(),
          offset: snapshot.verticalOffset,
          listRevision: openBrowseListRevision,
          marker: MOVIES_FOCUS_STAGE4J_MARKER,
        });
        traceOnnMoviesEvent('Overlay', 'detail_close_immutable_target_locked', {
          token,
          source: detailCloseSourceRef.current,
          origin: 'browse',
          movieId: immutableTarget.movieId,
          categoryId: immutableTarget.categoryId,
          renderedIndex: immutableTarget.renderedIndex,
          nativeHandle: immutableTarget.nativeHandle,
          gridInstanceId: immutableTarget.gridInstanceId,
          listRevision: immutableTarget.listRevision,
          originalOffset: immutableTarget.originalOffset,
          firstVisibleIndex: immutableTarget.firstVisibleIndex,
          lastVisibleIndex: immutableTarget.lastVisibleIndex,
          targetVisible: immutableTarget.targetVisible,
          marker: MOVIES_FOCUS_STAGE4K2_MARKER,
        });
        traceOnnMoviesEvent('Focus', 'detail_close_fallback_target_registration_state', {
          token,
          immutableMovieId: immutableTarget.movieId,
          nativeHandle: targetNativeHandle,
          registeredMovieId: stored?.contentId ?? null,
          gridInstanceId: getOnnMoviesGridInstanceId(),
          listRevision: openBrowseListRevision,
          visibleIndexes: {
            first: viewportStateRef.current.firstIndex,
            last: viewportStateRef.current.lastIndex,
          },
          renderedIndex: stored?.renderedIndex ?? snapshot.movieIndex,
          targetVisible: snapshotWasVisible,
          targetRefValid,
          returnPath,
          marker: MOVIES_FOCUS_STAGE4K2_MARKER,
        });
        traceOnnMoviesEvent('Overlay', 'detail_close_focus_owner_preserved', {
          token,
          source: detailCloseSourceRef.current,
          focusedDetailControl: actualFocusedComponentRef.current,
          marker: MOVIES_FOCUS_STAGE4J_MARKER,
        });
        traceOnnMoviesEvent('Focus', 'detail_close_requested', {
          source,
          closeSource: detailCloseSourceRef.current,
          token,
          movieId: snapshot.movieId,
          categoryId: snapshot.categoryId,
          renderedIndex: snapshot.movieIndex,
          listOffset: snapshot.verticalOffset,
          firstVisibleIndex: snapshot.visibleFirstIndex,
          lastVisibleIndex: snapshot.visibleLastIndex,
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
      focusRetryCountRef.current = 0;
      focusConfirmedTokenRef.current = null;
      nativeFocusEnvironmentReadyRef.current = false;
      targetFocusConfirmedRef.current = false;
      viewportStableRef.current = false;
      restoreTimingRef.current = createMoviesRestoreTiming(token);
      setLockScrollForFocusRestore(false);
      setViewportRestoreCommand(null);
      setFocusSuppressionHeld(true);
      // Stage 4.2K.2: closingFocusMovieId mirrors immutable target only — never mutates.
      setClosingFocusMovieId(immutableTarget.movieId);
      setRestoringBrowseFocus(true);

      // Stage 4.2K.2: watchdog guarantees exit from closing-* (not a confirm timer).
      if (closeWatchdogTimeoutRef.current) {
        clearTimeout(closeWatchdogTimeoutRef.current);
      }
      closeWatchdogTimeoutRef.current = setTimeout(() => {
        if (closeTransactionRef.current?.token !== token) {
          return;
        }
        if (closeTransactionRef.current.revealCommitted || closeTransactionRef.current.cancelled) {
          return;
        }
        if (focusConfirmedTokenRef.current === token) {
          return;
        }
        abortDetailCloseTransaction({ reason: 'watchdog', token });
      }, MOVIES_DETAIL_CLOSE_WATCHDOG_MS);

      const naturalReturn = shouldUseMoviesNaturalReturnPath(returnPath);
      // Stage 4.2K/K.1: all browse-origin closes share visual isolation lifecycle.
      const startPhase: MoviesDetailFocusPhase = naturalReturn
        ? 'return-focus-arming'
        : 'closing-prepare';
      setDetailVisualHoldSafe(true);
      // Stage 4.2L.2: skip prolonged gray isolation when the poster is already mounted/visible.
      const useIsolationCover = shouldUseMoviesDetailCloseIsolationCover({
        targetVisible: immutableTarget.targetVisible,
        targetRefMounted: Boolean(getValidatedPosterTarget(immutableTarget.movieId)),
      });
      setVisualIsolationSafe(useIsolationCover);
      visualIsolationTokenRef.current = useIsolationCover ? token : null;
      visualCoverTokenRef.current = useIsolationCover ? token : null;
      if (naturalReturn) {
        viewportStableRef.current = true;
      }
      if (detailCloseSourceRef.current === 'x' || naturalReturn) {
        setPreserveXCloseFocus(true);
      }
      if (isOnnMoviesTraceEnabled()) {
        traceOnnMoviesEvent('Overlay', 'detail_visual_hold_started', {
          token,
          returnPath,
          movieId: snapshot.movieId,
          listOffset: snapshot.verticalOffset,
          marker: MOVIES_FOCUS_STAGE4G_MARKER,
        });
        traceOnnMoviesEvent('Overlay', 'detail_close_visual_isolation_started', {
          token,
          source: detailCloseSourceRef.current,
          origin: 'browse',
          movieId: snapshot.movieId,
          offset: snapshot.verticalOffset,
          returnPath,
          marker: MOVIES_FOCUS_STAGE4K_MARKER,
        });
        if (naturalReturn) {
          traceOnnMoviesEvent('Focus', 'detail_close_native_focus_environment_armed', {
            token,
            source: detailCloseSourceRef.current,
            movieId: snapshot.movieId,
            elapsedMs: 0,
            marker: MOVIES_FOCUS_STAGE4K_MARKER,
          });
        }
      }
      setDetailFocusPhaseSafe(startPhase);
      logMoviesDetailFocusLifecycle({
        token,
        phase: startPhase,
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
        phase: startPhase,
        searchAllowed: false,
        navbarAllowed: false,
        categoryAllowed: false,
        firstPosterAllowed: false,
      });
      console.info('[NovaCast Movies Focus Handoff]', {
        marker: naturalReturn ? MOVIES_FOCUS_STAGE4G_MARKER : MOVIES_FOCUS_STAGE4F_MARKER,
        stage3d1Marker: MOVIES_FOCUS_STAGE3D1_MARKER,
        categoryId: selectedCategoryId,
        phase: startPhase,
        intendedMovieId: snapshot.movieId,
        returnPath,
        focusRequested: true,
        detailOpened: true,
      });

      // Stage 4.2K.2: confirmation timeout starts after focus request settles — not here.
      if (confirmTimeoutRef.current) {
        clearTimeout(confirmTimeoutRef.current);
        confirmTimeoutRef.current = null;
      }

      return true;
    },
    [
      abortDetailCloseTransaction,
      activeProviderId,
      getValidatedPosterTarget,
      selectedCategoryId,
      setDetailFocusPhaseSafe,
      setDetailVisualHoldSafe,
      setVisualIsolationSafe,
      visibleMovies,
    ],
  );

  /**
   * Stage 4.2K.2: request-scoped 350 ms confirmation timer.
   * Starts only after the native focus request for this attempt has settled.
   */
  const startFocusConfirmTimerForAttempt = useCallback(
    (input: { token: string; attempt: MoviesDetailCloseFocusAttempt }) => {
      const { token, attempt } = input;
      const immutableMovieId = getImmutableCloseTargetMovieId();
      if (!immutableMovieId) {
        return;
      }
      if (
        !shouldStartMoviesDetailFocusConfirmTimer({
          token,
          activeToken: detailFocusTokenRef.current?.token ?? null,
          attemptId: attempt.attemptId,
          currentAttemptId: focusAttemptRef.current?.attemptId ?? null,
          focusConfirmed: focusConfirmedTokenRef.current === token,
          requestSettled: attempt.requestSettledAt != null,
        })
      ) {
        return;
      }

      if (confirmTimeoutRef.current) {
        clearTimeout(confirmTimeoutRef.current);
        confirmTimeoutRef.current = null;
      }

      const timeoutMs = MOVIES_DETAIL_FOCUS_CONFIRM_TIMEOUT_MS;
      const txStartedAt = closeTransactionRef.current?.startedAt ?? Date.now();
      const requestStartedElapsedMs =
        attempt.requestStartedAt != null ? attempt.requestStartedAt - txStartedAt : null;
      const deadlineElapsedMs =
        (attempt.requestSettledAt ?? Date.now()) - txStartedAt + timeoutMs;
      const confirmationDeadline = Date.now() + timeoutMs;
      focusAttemptRef.current = {
        ...attempt,
        confirmationDeadline,
      };

      if (isOnnMoviesTraceEnabled()) {
        traceOnnMoviesEvent('Focus', 'detail_close_focus_confirmation_timer_started', {
          token,
          attemptNumber: attempt.attemptNumber,
          targetMovieId: immutableMovieId,
          timeoutMs,
          requestStartedElapsedMs,
          deadlineElapsedMs,
          marker: MOVIES_FOCUS_STAGE4K2_MARKER,
        });
      }

      confirmTimeoutRef.current = setTimeout(() => {
        if (!isMoviesDetailClosingPhase(detailFocusPhaseRef.current)) {
          return;
        }
        if (detailFocusTokenRef.current?.token !== token) {
          return;
        }
        if (focusAttemptRef.current?.attemptId !== attempt.attemptId) {
          return;
        }
        if (focusConfirmedTokenRef.current === token) {
          return;
        }
        const activeImmutable = getImmutableCloseTargetMovieId();
        if (!activeImmutable || activeImmutable !== attempt.targetMovieId) {
          return;
        }
        if (isOnnMoviesTraceEnabled()) {
          traceOnnMoviesEvent('Focus', 'detail_close_focus_confirmation_timeout', {
            token,
            source: detailCloseSourceRef.current,
            movieId: activeImmutable,
            attemptNumber: attempt.attemptNumber,
            focusRequestCount: focusRequestCountRef.current,
            retryCount: focusRetryCountRef.current,
            elapsedMs: Date.now() - (closeTransactionRef.current?.startedAt ?? Date.now()),
            requestScopedElapsedMs:
              attempt.requestSettledAt != null ? Date.now() - attempt.requestSettledAt : null,
            marker: MOVIES_FOCUS_STAGE4K_MARKER,
          });
        }
        if (
          !shouldScheduleMoviesDetailFocusRetry({
            focusConfirmedForToken: focusConfirmedTokenRef.current === token,
          })
        ) {
          return;
        }

        // At most one retry — same immutable movieId only.
        if (focusRetryCountRef.current >= MOVIES_DETAIL_FOCUS_MAX_RETRIES) {
          if (
            shouldAbortMoviesDetailCloseAfterFailedAttempts({
              focusRequestCount: focusRequestCountRef.current,
              maxFocusRequests: MOVIES_MAX_FOCUS_REQUESTS,
              focusConfirmed: false,
            })
          ) {
            // Stage 4.2L.2: prefer usable browse over reopening Detail after focus failure.
            forceCompleteDetailCloseWithoutFocus({
              token,
              movieId: activeImmutable,
              reason: 'focus-attempts-exhausted',
            });
          }
          return;
        }

        const stored = posterRefs.current.get(activeImmutable);
        const resolvedHandle = getValidatedPosterTarget(activeImmutable);
        const nativeHandle = resolvedHandle ? findNodeHandle(resolvedHandle) : null;
        const retryResolved = resolveMoviesDetailCloseRetryTarget({
          immutableMovieId: activeImmutable,
          resolvedMovieId: stored?.contentId === activeImmutable ? activeImmutable : null,
          nativeHandle,
          refMatched: Boolean(stored) && stored!.contentId === activeImmutable,
          gridInstanceMatched:
            !immutableCloseTargetRef.current?.gridInstanceId ||
            immutableCloseTargetRef.current.gridInstanceId === getOnnMoviesGridInstanceId(),
          listRevisionMatched:
            !immutableCloseTargetRef.current ||
            immutableCloseTargetRef.current.listRevision === getMoviesBrowseListRevision(),
        });
        if (isOnnMoviesTraceEnabled()) {
          traceOnnMoviesEvent('Focus', 'detail_close_retry_target_resolved', {
            token,
            ...retryResolved,
            marker: MOVIES_FOCUS_STAGE4K2_MARKER,
          });
        }
        if (!retryResolved.ok || retryResolved.resolvedMovieId !== activeImmutable) {
          forceCompleteDetailCloseWithoutFocus({
            token,
            movieId: activeImmutable,
            reason: 'retry-target-unresolved',
          });
          return;
        }

        focusRetryCountRef.current += 1;
        if (isOnnMoviesTraceEnabled()) {
          traceOnnMoviesEvent('Focus', 'detail_close_focus_retry_scheduled', {
            token,
            movieId: activeImmutable,
            retryCount: focusRetryCountRef.current,
            marker: MOVIES_FOCUS_STAGE4K_MARKER,
          });
        }
        // One committed frame — never change closingFocusMovieId / immutable target.
        const rafId = requestAnimationFrame(() => {
          if (detailFocusTokenRef.current?.token !== token) {
            return;
          }
          if (
            !shouldScheduleMoviesDetailFocusRetry({
              focusConfirmedForToken: focusConfirmedTokenRef.current === token,
            })
          ) {
            return;
          }
          if (focusAttemptRef.current) {
            focusAttemptRef.current = { ...focusAttemptRef.current, retryRafId: null };
          }
          focusIssuedTokenRef.current = null;
          if (isOnnMoviesTraceEnabled()) {
            traceOnnMoviesEvent('Focus', 'detail_close_focus_retry_executed', {
              token,
              movieId: activeImmutable,
              retryCount: focusRetryCountRef.current,
              marker: MOVIES_FOCUS_STAGE4K_MARKER,
            });
          }
          setRestorationRetry((value) => value + 1);
        });
        if (focusAttemptRef.current) {
          focusAttemptRef.current = { ...focusAttemptRef.current, retryRafId: rafId };
        }
        closeRafIdsRef.current.push(rafId);
        logMoviesDetailFocusConflict({
          token,
          phase: detailFocusPhaseRef.current,
          winningComponent: 'MoviesScreen',
          targetMovieId: activeImmutable,
          actuallyFocusedMovieId: null,
          reason: 'timeout-revalidate-exact-target',
        });
      }, timeoutMs);
    },
    [
      forceCompleteDetailCloseWithoutFocus,
      getImmutableCloseTargetMovieId,
      getValidatedPosterTarget,
    ],
  );

  const releaseXCloseOwnership = useCallback(
    (reason: 'detail-closed' | 'cancelled' | 'movie-changed') => {
      xCloseActivationLockRef.current = resetMoviesDetailXCloseActivationLock();
      setXCloseActivationLocked(false);
      setPreserveXCloseFocus(false);
      if (isOnnMoviesTraceEnabled() && reason === 'detail-closed') {
        // Emitted from finishReveal with richer payload when poster confirms.
      }
    },
    [],
  );

  /**
   * Stage 4.2M — Back and X share this exact close path.
   * One state transition; one optional safe origin focus request; no isolation.
   */
  const closeDetailOverlay = useCallback(
    (source: 'back' | 'x') => {
      if (!detailOpenRef.current || detailCloseInFlightRef.current) {
        return;
      }
      detailCloseInFlightRef.current = true;
      detailCloseSourceRef.current = source;

      const originItemId =
        browseFocusSnapshotRef.current?.movieId ??
        selectedMovie?.id ??
        searchRestoreMovieId ??
        null;
      const fromSearch = detailSourceRef.current === 'search';

      logDetailOverlayEvent('movies_detail_overlay_close', {
        source,
        originItemId,
        fromSearch,
        marker: MOVIES_FOCUS_STAGE4M_MARKER,
      });

      // Immediate guest dismiss — browse stays mounted underneath.
      detailOpenRef.current = false;
      setDetailOpen(false);
      setDetailSuppressedForPlayback(false);
      setDetailFocusPhaseSafe('browse');
      setDetailVisualHoldSafe(false);
      setVisualIsolationSafe(false);
      setPreserveXCloseFocus(false);
      setXCloseActivationLocked(false);
      setMoviesBrowseUiFrozenForDetail(false);
      closeTransactionRef.current = null;
      detailFocusTokenRef.current = null;
      immutableCloseTargetRef.current = null;
      detailReturnPathRef.current = null;
      releaseXCloseOwnership('detail-closed');

      if (fromSearch && originItemId) {
        setSearchRestoreMovieId(originItemId);
        setSearchOverlayReady(true);
        setSearchPhase('returning');
        searchPhaseRef.current = 'returning';
        searchReturnPendingRef.current = true;
        setSearchReturnPending(true);
      }

      // At most one safe origin focus request after close. Never keep overlay open waiting.
      if (originItemId && !fromSearch) {
        // Stage 4.2N fix: defer by one frame so React has committed the
        // `detailFocusPhase === 'browse'` re-render (which flips the origin
        // poster's native `focusable`/`disabled` props back on) BEFORE we
        // call `.focus()`. Without this, `.focus()` fires synchronously in
        // the same tick as the state update and silently no-ops on Android
        // because the poster's native view is still non-focusable from the
        // pre-close render. A nested double rAF gives the native bridge an
        // extra frame to flush the committed `focusable` prop (see the
        // matching comment in `closeMovieDetailPopupV2` for the full
        // on-device diagnosis).
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            requestTvFocus({
              screen: 'movies',
              source: 'MoviesScreen',
              region: 'poster-grid',
              itemId: originItemId,
              reason: 'stage4m-restore-origin-poster',
              maxFrames: 3,
              isActive: () => !detailOpenRef.current,
              getTarget: () => getValidatedPosterTarget(originItemId),
              onResult: (result: RequestTvFocusResult) => {
                logDetailOverlayEvent('movies_detail_origin_focus_result', {
                  originItemId,
                  requested: result.requested,
                  reason: result.reason,
                  marker: MOVIES_FOCUS_STAGE4M_MARKER,
                });
              },
            });
          });
        });
      } else if (!fromSearch) {
        // No valid origin — leave browse responsive; do not focus Search.
        logDetailOverlayEvent('movies_detail_origin_focus_skipped', {
          reason: 'origin-missing',
          marker: MOVIES_FOCUS_STAGE4M_MARKER,
        });
      }

      detailCloseInFlightRef.current = false;
    },
    [
      getValidatedPosterTarget,
      releaseXCloseOwnership,
      searchRestoreMovieId,
      selectedMovie?.id,
      setDetailFocusPhaseSafe,
      setDetailVisualHoldSafe,
      setVisualIsolationSafe,
    ],
  );

  const closeDetail = useCallback(
    (closeSource: 'back' | 'x' | 'other' = 'other') => {
      // Stage 4.2M: Back and X invoke the same guest close. 'other' maps to 'x'.
      closeDetailOverlay(closeSource === 'back' ? 'back' : 'x');
    },
    [closeDetailOverlay],
  );

  /**
   * Stage 4.2N — MovieDetailPopupV2's own close path.
   * Back and X call this exact function. One state transition; at most one
   * safe origin focus request after close. No closing-* phases, no visual
   * isolation, no hold cover, no transaction watchdog, no Search bridge for
   * browse-origin closes.
   */
  const closeMovieDetailPopupV2 = useCallback(
    (source: 'back' | 'x') => {
      if (!detailPopupOpenRef.current || detailPopupCloseInFlightRef.current) {
        return;
      }
      detailPopupCloseInFlightRef.current = true;

      const originItemId = detailPopup.originItemId ?? detailPopup.movie?.id ?? null;
      const fromSearch = detailSourceRef.current === 'search';
      const fromDiscoverZone = shouldReturnToDiscoverZone(detailLaunchOriginRef.current);

      logMovieDetailPopupV2Event('movie_detail_popup_v2_close', {
        source,
        originItemId,
        fromSearch,
        fromDiscoverZone,
      });
      if (fromDiscoverZone) {
        logDiscoverZoneDetailBack({
          itemId: originItemId,
          origin: DISCOVERY_ZONE_ORIGIN,
          destination: DISCOVERY_ZONE_ORIGIN,
        });
      }
      logMoviesDetailV2FocusOwnership({
        phase: 'detail-close',
        movieId: originItemId,
        detailOpen: false,
        focusIssued: false,
        focusedRegion: 'browse',
        categoryHostFocusable: true,
        posterHostFocusable: true,
      });

      // Immediate guest dismiss — browse stays mounted underneath.
      detailPopupOpenRef.current = false;
      setDetailPopup({ open: false, movie: null, originItemId: null });
      detailOpenRef.current = false;
      setDetailOpen(false);
      setDetailSuppressedForPlayback(false);
      setDetailFocusPhaseSafe('browse');
      setMoviesBrowseUiFrozenForDetail(false);
      // Stage 4.2N fix: force the origin poster focusable in this SAME
      // transition (see `v2CloseFocusTargetId` declaration for full
      // diagnosis). `detailFocusPhase` flipping to 'browse' also flips
      // `chromeFocusable` (Search/nav) true in this exact same commit;
      // without this, both the poster and Search become newly-focusable
      // together and Android's native default-focus-search can grab Search
      // before the poster's `postersFocusable`-gated native prop actually
      // lands, no matter how long `.focus()` is deferred.
      if (originItemId && !fromSearch) {
        if (!fromDiscoverZone) {
          setV2CloseFocusTargetId(originItemId);
        }
      }

      if (fromSearch && originItemId) {
        setSearchRestoreMovieId(originItemId);
        setSearchOverlayReady(true);
        setSearchPhase('returning');
        searchPhaseRef.current = 'returning';
        searchReturnPendingRef.current = true;
        setSearchReturnPending(true);
      }

      // Origin poster restore runs only after Detail has actually closed.
      // Never request browse focus while detailPopup.open is still true.
      if (detailPopupOpenRef.current) {
        logMoviesDetailV2FocusOwnership({
          phase: 'unexpected-background-focus',
          movieId: originItemId,
          detailOpen: true,
          focusIssued: false,
          focusedRegion: 'origin-restore-while-open',
          categoryHostFocusable: false,
          posterHostFocusable: false,
        });
        detailPopupCloseInFlightRef.current = false;
        return;
      }

      // At most one safe origin focus request after close. Never keep the
      // popup open waiting, never reopen, never send focus through Search.
      if (originItemId && !fromSearch) {
        if (!fromDiscoverZone) {
          // A short double-rAF defer still gives the native bridge time to
          // attach/mount the poster view before `.focus()` runs; the force-
          // focusable flag above (not this defer) is what fixes the Search
          // steal, since it makes the poster focusable from the very first
          // post-close render instead of waiting on `postersFocusable`.
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              requestTvFocus({
                screen: 'movies',
                source: 'MoviesScreen',
                region: 'poster-grid',
                itemId: originItemId,
                reason: 'stage4n-restore-origin-poster',
                maxFrames: 3,
                isActive: () => !detailPopupOpenRef.current,
                getTarget: () => getValidatedPosterTarget(originItemId),
                onResult: (result: RequestTvFocusResult) => {
                  logMovieDetailPopupV2Event('movie_detail_popup_v2_origin_focus_result', {
                    originItemId,
                    requested: result.requested,
                    reason: result.reason,
                  });
                  if (result.requested && !detailPopupOpenRef.current) {
                    logMoviesDetailV2FocusOwnership({
                      phase: 'origin-focus-restored',
                      movieId: originItemId,
                      detailOpen: false,
                      focusIssued: true,
                      focusedRegion: 'poster-grid',
                      categoryHostFocusable: true,
                      posterHostFocusable: true,
                    });
                  }
                  setV2CloseFocusTargetId((current) => (current === originItemId ? null : current));
                },
              });
            });
          });
        }
      } else if (!fromSearch) {
        if (!fromDiscoverZone) {
          logMovieDetailPopupV2Event('movie_detail_popup_v2_origin_focus_skipped', {
            reason: 'origin-missing',
          });
        }
      }

      detailPopupCloseInFlightRef.current = false;
    },
    [
      detailPopup.movie?.id,
      detailPopup.originItemId,
      getValidatedPosterTarget,
      setDetailFocusPhaseSafe,
    ],
  );

  // Stage 4.2G natural: return-focus-requested → confirmed → closed.
  // Stage 3D.1 fallback: prepare → viewport lock → focus → confirm.
  useEffect(() => {
    const token = detailFocusTokenRef.current;
    const phase = detailFocusPhaseRef.current;
    if (!token || !isMoviesDetailClosingPhase(phase)) {
      return;
    }

    const snapshot = token.snapshot;
    // Stage 4.2K.2: every request/retry uses the immutable transaction target only.
    const targetMovieId =
      getImmutableCloseTargetMovieId() ?? snapshot.movieId;
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

    const issuePosterFocusRequest = (requestPhase: MoviesDetailFocusPhase) => {
      if (
        !shouldIssueMoviesDetailCloseFocusRequest({
          phase: requestPhase,
          nativeEnvironmentReady: nativeFocusEnvironmentReadyRef.current || requestPhase === 'closing-focus',
          focusAlreadyIssued: focusIssuedTokenRef.current === token.token,
          focusRequestCount: focusRequestCountRef.current,
          maxFocusRequests: MOVIES_MAX_FOCUS_REQUESTS,
        })
      ) {
        return;
      }
      if (!targetInPage) {
        return;
      }

      const attempt = createMoviesDetailCloseFocusAttempt({
        token: token.token,
        targetMovieId,
        attemptNumber: focusRequestCountRef.current + 1,
      });
      focusAttemptRef.current = attempt;
      focusIssuedTokenRef.current = token.token;
      focusRequestCountRef.current += 1;
      setLockScrollForFocusRestore(true);
      // Keep preferred/focusable pin on the immutable target only.
      if (closingFocusMovieId !== targetMovieId) {
        setClosingFocusMovieId(targetMovieId);
      }

      const issueFocusRequest = () => {
        if (detailFocusTokenRef.current?.token !== token.token) {
          focusIssuedTokenRef.current = null;
          setLockScrollForFocusRestore(false);
          return;
        }
        const requestMovieId = getImmutableCloseTargetMovieId() ?? targetMovieId;
        if (
          isMoviesDetailCloseTargetMutation({
            immutableMovieId: targetMovieId,
            requestMovieId,
          })
        ) {
          if (isOnnMoviesTraceEnabled()) {
            traceOnnMoviesEvent('Focus', 'detail_close_target_mutation_violation', {
              token: token.token,
              immutableMovieId: targetMovieId,
              requestMovieId,
              attemptNumber: attempt.attemptNumber,
              marker: MOVIES_FOCUS_STAGE4K2_MARKER,
            });
          }
          abortDetailCloseTransaction({
            reason: 'target-mutation',
            token: token.token,
          });
          return;
        }
        const requestStartedAt = Date.now();
        if (focusAttemptRef.current?.attemptId === attempt.attemptId) {
          focusAttemptRef.current = {
            ...focusAttemptRef.current,
            requestStartedAt,
          };
        }
        // Resolve by movie ID — do not require rendered-index match (recycle-safe).
        const targetHandle = getValidatedPosterTarget(requestMovieId);
        if (isOnnMoviesTraceEnabled()) {
          const stored = posterRefs.current.get(requestMovieId);
          traceOnnMoviesEvent('Focus', 'detail_close_fallback_target_registration_state', {
            token: token.token,
            immutableMovieId: requestMovieId,
            nativeHandle: targetHandle ? findNodeHandle(targetHandle) : null,
            registeredMovieId: stored?.contentId ?? null,
            gridInstanceId: getOnnMoviesGridInstanceId(),
            listRevision: getMoviesBrowseListRevision(),
            visibleIndexes: {
              first: viewportStateRef.current.firstIndex,
              last: viewportStateRef.current.lastIndex,
            },
            renderedIndex: stored?.renderedIndex ?? targetIndex,
            targetVisible: snapshotWasVisible,
            marker: MOVIES_FOCUS_STAGE4K2_MARKER,
          });
          traceOnnMoviesEvent('Focus', 'detail_close_focus_request_started', {
            token: token.token,
            source: detailCloseSourceRef.current,
            origin: 'browse',
            movieId: requestMovieId,
            nativeHandle: targetHandle ? findNodeHandle(targetHandle) : null,
            gridInstanceId: getOnnMoviesGridInstanceId(),
            attemptNumber: attempt.attemptNumber,
            elapsedMs: Date.now() - (closeTransactionRef.current?.startedAt ?? Date.now()),
            marker: MOVIES_FOCUS_STAGE4K_MARKER,
          });
          traceOnnMoviesEvent('Focus', 'focus_request', {
            targetMovieId: requestMovieId,
            requestReason:
              token.source === 'detail-close'
                ? 'restore-exact-poster-after-detail-close'
                : 'restore-after-playback-exact-poster',
            attemptNumber: attempt.attemptNumber,
            detailPhase: detailFocusPhaseRef.current,
            gridOffset: viewportStateRef.current.offset,
            firstVisibleIndex: viewportStateRef.current.firstIndex,
            lastVisibleIndex: viewportStateRef.current.lastIndex,
            targetVisible: snapshotWasVisible,
            gridInstanceId: getOnnMoviesGridInstanceId(),
            closeSource: detailCloseSourceRef.current,
            marker: MOVIES_FOCUS_STAGE4G_MARKER,
          });
          if (detailCloseSourceRef.current === 'x') {
            traceOnnMoviesEvent('Focus', 'detail_x_poster_focus_requested', {
              targetMovieId: requestMovieId,
              targetNativeHandle: targetHandle ? findNodeHandle(targetHandle) : null,
              token: token.token,
              marker: MOVIES_FOCUS_STAGE4H_MARKER,
            });
          }
          traceOnnMoviesScrollSample(
            'pre-poster-focus',
            { offset: viewportStateRef.current.offset },
            true,
          );
        }
        const focusTarget = getValidatedPosterTarget(requestMovieId);
        if (!focusTarget) {
          console.info(
            '[NovaCast Movies Focus] ' +
              JSON.stringify({
                event: 'movies_detail_return_focus_target_invalid',
                marker: MOVIES_FOCUS_STAGE4L2_MARKER,
                token: token.token,
                movieId: requestMovieId,
                reason: 'target-missing',
              }),
          );
        }
        requestTvFocus({
          screen: 'movies',
          source: 'MoviesScreen',
          region: 'poster-grid',
          itemId: requestMovieId,
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
          getTarget: () => getValidatedPosterTarget(requestMovieId),
          onResult: (result: RequestTvFocusResult) => {
            if (detailFocusTokenRef.current?.token !== token.token) {
              return;
            }
            if (result.requested && result.reason === 'ok') {
              console.info(
                '[NovaCast Movies Focus] ' +
                  JSON.stringify({
                    event: 'movies_detail_return_focus_request_succeeded',
                    marker: MOVIES_FOCUS_STAGE4L2_MARKER,
                    token: token.token,
                    movieId: requestMovieId,
                  }),
              );
              return;
            }
            console.info(
              '[NovaCast Movies Focus] ' +
                JSON.stringify({
                  event: 'movies_detail_return_focus_request_failed',
                  marker: MOVIES_FOCUS_STAGE4L2_MARKER,
                  token: token.token,
                  movieId: requestMovieId,
                  reason: result.reason,
                }),
            );
            // Stage 4.2L.2: failed focus must not trap Detail closing — reveal browse.
            if (
              result.reason === 'target-focus-method-unavailable' ||
              result.reason === 'focus-threw'
            ) {
              forceCompleteDetailCloseWithoutFocus({
                token: token.token,
                movieId: requestMovieId,
                reason: result.reason,
              });
            }
          },
          onSettled: (status) => {
            if (detailFocusTokenRef.current?.token !== token.token) {
              if (isOnnMoviesTraceEnabled()) {
                traceOnnMoviesEvent('Overlay', 'detail_close_stale_callback_dropped', {
                  token: token.token,
                  reason: 'focus-settled-stale',
                  marker: MOVIES_FOCUS_STAGE4J_MARKER,
                });
              }
              return;
            }
            const settledAt = Date.now();
            const currentAttempt = focusAttemptRef.current;
            if (currentAttempt?.attemptId === attempt.attemptId) {
              focusAttemptRef.current = {
                ...currentAttempt,
                requestSettledAt: settledAt,
              };
            }
            if (isOnnMoviesTraceEnabled()) {
              traceOnnMoviesEvent('Focus', 'detail_close_focus_request_settled', {
                token: token.token,
                source: detailCloseSourceRef.current,
                origin: 'browse',
                movieId: requestMovieId,
                status,
                attemptNumber: attempt.attemptNumber,
                marker: MOVIES_FOCUS_STAGE4K_MARKER,
              });
            }
            logMoviesDetailFocusLifecycle({
              token: token.token,
              phase: requestPhase,
              targetMovieId: requestMovieId,
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
            }
            // Stage 4.2K.2: confirmation window begins only after this attempt settled.
            const settledAttempt = focusAttemptRef.current;
            if (settledAttempt?.attemptId === attempt.attemptId) {
              startFocusConfirmTimerForAttempt({
                token: token.token,
                attempt: settledAttempt,
              });
            }
          },
        });
      };

      // Mounted+in-page: skip InteractionManager lag and issue immediately.
      if (snapshotWasVisible && targetInPage) {
        issueFocusRequest();
      } else {
        InteractionManager.runAfterInteractions(issueFocusRequest);
      }
    };

    // Stage 4.2K: wait one committed frame after handoff before requesting focus.
    if (phase === 'return-focus-arming') {
      const naturalReturn = shouldUseMoviesNaturalReturnPath(detailReturnPathRef.current);
      const focusHiddenHandoff = shouldFocusMoviesDetailHiddenHandoffTarget({
        closeSource: detailCloseSourceRef.current,
        naturalReturn,
      });
      if (focusHiddenHandoff) {
        overlayCloseTargetRef.current?.focus();
      } else if (isOnnMoviesTraceEnabled()) {
        traceOnnMoviesEvent('Focus', 'detail_x_hidden_handoff_focus_skipped', {
          closeSource: detailCloseSourceRef.current,
          token: token.token,
          skippedHiddenHandoffFocus: true,
          naturalReturn,
          marker: MOVIES_FOCUS_STAGE4H_MARKER,
        });
      }
      if (isOnnMoviesTraceEnabled()) {
        traceOnnMoviesEvent('Overlay', 'detail_close_visual_isolation_confirmed', {
          token: token.token,
          source: detailCloseSourceRef.current,
          movieId: targetMovieId,
          visualIsolationActive: visualIsolationRef.current,
          marker: MOVIES_FOCUS_STAGE4K_MARKER,
        });
      }
      const rafId = requestAnimationFrame(() => {
        if (detailFocusTokenRef.current?.token !== token.token) {
          return;
        }
        if (detailFocusPhaseRef.current !== 'return-focus-arming') {
          return;
        }
        nativeFocusEnvironmentReadyRef.current = true;
        if (isOnnMoviesTraceEnabled()) {
          traceOnnMoviesEvent('Focus', 'detail_close_native_focus_environment_ready', {
            token: token.token,
            source: detailCloseSourceRef.current,
            movieId: targetMovieId,
            elapsedMs: Date.now() - (closeTransactionRef.current?.startedAt ?? Date.now()),
            marker: MOVIES_FOCUS_STAGE4K_MARKER,
          });
        }
        setDetailFocusPhaseSafe('return-focus-requested');
      });
      closeRafIdsRef.current.push(rafId);
      return;
    }

    // Stage 4.2G/K natural mounted return — one focus request after native-ready.
    if (phase === 'return-focus-requested') {
      if (restoreTimingRef.current?.token === token.token && restoreTimingRef.current.viewportConfirmedAt == null) {
        restoreTimingRef.current.viewportConfirmedAt = Date.now();
      }
      if (targetFocusConfirmedRef.current && targetMovieId) {
        completeDetailFocusRestore(targetMovieId, true);
        return;
      }
      if (!nativeFocusEnvironmentReadyRef.current) {
        // Arming rAF not yet complete — do not race a premature request.
        return;
      }
      issuePosterFocusRequest('return-focus-requested');
      return;
    }

    if (phase === 'return-focus-confirmed') {
      if (targetFocusConfirmedRef.current && targetMovieId && viewportStable) {
        completeDetailFocusRestore(targetMovieId, true);
      }
      return;
    }

    if (phase === 'closing-prepare') {
      // Fallback only — natural/fast path never enters closing-prepare.
      if (shouldUseMoviesNaturalReturnPath(detailReturnPathRef.current)) {
        if (isOnnMoviesTraceEnabled()) {
          traceOnnMoviesEvent('Scroll', 'fast_path_initial_restore_violation', {
            token: token.token,
            reason: 'unexpected-closing-prepare',
            returnPath: detailReturnPathRef.current,
            marker: MOVIES_FOCUS_STAGE4G_MARKER,
          });
        }
        setDetailFocusPhaseSafe('return-focus-arming');
        return;
      }
      // Stage 4.2K.1: isolation already started in beginDetailFocusClose; confirm cover.
      if (isOnnMoviesTraceEnabled()) {
        traceOnnMoviesEvent('Overlay', 'detail_close_visual_isolation_confirmed', {
          token: token.token,
          source: detailCloseSourceRef.current,
          movieId: targetMovieId,
          visualIsolationActive: visualIsolationRef.current,
          returnPath: detailReturnPathRef.current,
          marker: MOVIES_FOCUS_STAGE4K_MARKER,
        });
      }
      requestAnimationFrame(() => {
        const focusHiddenHandoff = shouldFocusMoviesDetailHiddenHandoffTarget({
          closeSource: detailCloseSourceRef.current,
          naturalReturn: false,
        });
        if (focusHiddenHandoff) {
          overlayCloseTargetRef.current?.focus();
        } else if (isOnnMoviesTraceEnabled()) {
          traceOnnMoviesEvent('Focus', 'detail_x_hidden_handoff_focus_skipped', {
            closeSource: detailCloseSourceRef.current,
            token: token.token,
            skippedHiddenHandoffFocus: true,
            phase: 'closing-prepare',
            marker: MOVIES_FOCUS_STAGE4H_MARKER,
          });
        }
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

      // Stage 4.2G: natural/fast path must never use closing-viewport.
      if (shouldUseMoviesNaturalReturnPath(returnPath)) {
        if (isOnnMoviesTraceEnabled()) {
          traceOnnMoviesEvent('Scroll', 'fast_path_initial_restore_violation', {
            token: token.token,
            reason: 'unexpected-closing-viewport',
            returnPath,
            marker: MOVIES_FOCUS_STAGE4G_MARKER,
          });
        }
        setDetailFocusPhaseSafe('return-focus-arming');
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

        if (
          isMoviesFastPathInitialRestoreViolation({
            returnPath,
            reason: 'initial',
          })
        ) {
          if (isOnnMoviesTraceEnabled()) {
            traceOnnMoviesEvent('Scroll', 'fast_path_initial_restore_violation', {
              token: token.token,
              reason: 'initial-detail-restore',
              source: 'MoviesScreen.closing-viewport',
              requestedOffset: snapshot.verticalOffset,
              currentOffset,
              returnPath,
              marker: MOVIES_FOCUS_STAGE4G_MARKER,
            });
          }
          setDetailFocusPhaseSafe('return-focus-arming');
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
    if (targetFocusConfirmedRef.current && targetMovieId) {
      completeDetailFocusRestore(targetMovieId, true);
      return;
    }

    issuePosterFocusRequest('closing-focus');
  }, [
    abortDetailCloseTransaction,
    closingFocusMovieId,
    completeDetailFocusRestore,
    forceCompleteDetailCloseWithoutFocus,
    getImmutableCloseTargetMovieId,
    getValidatedPosterTarget,
    restorationRetry,
    setDetailFocusPhaseSafe,
    startFocusConfirmTimerForAttempt,
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
        if (isPlaybackResumePromptOpen()) {
          return false;
        }

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

        // Stage 4.2G: UnifiedPlayerController owns Back while player is active.
        // Movies must not close Detail or browse-restore for that same press.
        if (playbackClosing || launchingPlayback) {
          if (isUnifiedRemoteDebugEnabled()) {
            logUnifiedRemoteEvent({
              source: 'BackHandler',
              eventType: 'hardwareBackPress',
              disposition: 'consumed',
              actionTaken: 'ignored-playback-closing',
            });
          }
          if (isOnnMoviesTraceEnabled()) {
            traceOnnMoviesEvent('Back', 'playback_back_consumed', {
              owner: 'MoviesScreen',
              action: 'swallow-playback-transition',
              marker: MOVIES_FOCUS_STAGE4G_MARKER,
            });
          }
          return true;
        }
        if (playbackActive) {
          if (isOnnMoviesTraceEnabled()) {
            traceOnnMoviesEvent('Back', 'playback_back_consumed', {
              owner: 'UnifiedPlayerController',
              action: 'defer-to-player',
              marker: MOVIES_FOCUS_STAGE4G_MARKER,
            });
          }
          // Let the player handler consume this press (do not close Detail).
          return false;
        }
        if (!shouldMoviesHostHandlePlaybackBack({ playbackActive, playbackClosing })) {
          return true;
        }

        // One layer per press: resume and player must win before Detail.
        if (
          shouldMoviesCloseDetailOnBack({
            resumeDialogOpen: resumePromptOpen,
            playbackActive,
            playbackClosing,
            launchingPlayback,
            detailPopupOpen: detailPopupOpenRef.current,
            didJustClose,
            detailSuppressedForPlayback,
          })
        ) {
          closeMovieDetailPopupV2('back');
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
    closeMovieDetailPopupV2,
    closePlayback,
    closeSearch,
    detailOpen,
    detailSuppressedForPlayback,
    didJustClose,
    guide.visible,
    launchingPlayback,
    loadStatus,
    playbackActive,
    playbackClosing,
    resumePromptOpen,
    router,
    searchOpen,
    selectedCategoryId,
    visibleMovies.length,
  ]);

  /**
   * Stage 4.2N — MovieDetailPopupV2's dedicated Back handler.
   * Defense-in-depth only: the legacy Movies Back handler above already
   * guards on `detailPopupOpenRef.current` at its very top and calls the
   * same close function, so this one is not required to win any
   * BackHandler listener-registration-order race (that race is exactly
   * what caused the popup-open Back press to fall through to legacy
   * screen-level navigation instead of just closing the popup). Back and X
   * call the exact same close function either way.
   */
  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }
    const onPopupBackPress = () => {
      if (
        isPlaybackResumePromptOpen() ||
        playbackActive ||
        playbackClosing ||
        launchingPlayback ||
        didJustClose ||
        detailSuppressedForPlayback
      ) {
        return false;
      }
      if (detailPopup.open) {
        closeMovieDetailPopupV2('back');
        return true;
      }
      return false;
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', onPopupBackPress);
    return () => subscription.remove();
  }, [
    closeMovieDetailPopupV2,
    detailPopup.open,
    detailSuppressedForPlayback,
    didJustClose,
    launchingPlayback,
    playbackActive,
    playbackClosing,
  ]);

  useEffect(() => {
    if (!didJustClose) {
      return;
    }

    setLaunchingPlayback(false);
    finishUnifiedPlaybackClose();
    setDetailSuppressedForPlayback(false);

    const returnTarget = playbackReturnTargetRef.current;
    playbackReturnTargetRef.current = null;

    if (isOnnMoviesTraceEnabled()) {
      traceOnnMoviesEvent('Playback', 'playback_closed', {
        returnTargetKind: returnTarget?.kind ?? null,
        movieId: returnTarget && 'movieId' in returnTarget ? returnTarget.movieId : null,
        detailOpen: detailOpenRef.current,
        detailFocusPhase: detailFocusPhaseRef.current,
        marker: MOVIES_FOCUS_STAGE4G_MARKER,
      });
    }

    // Stage 4.2G: didJustClose is not close-detail — honor the saved return target.
    if (isMoviesPlaybackReturnToDetail(returnTarget)) {
      if (isOnnMoviesTraceEnabled()) {
        traceOnnMoviesEvent('Playback', 'playback_returning_to_detail', {
          kind: returnTarget.kind,
          movieId: returnTarget.movieId,
          detailFocusTarget: returnTarget.detailFocusTarget,
          marker: MOVIES_FOCUS_STAGE4G_MARKER,
        });
      }
      detailOpenRef.current = true;
      setDetailOpen(true);
      setDetailFocusPhaseSafe('detail-open');
      const restoredMovie = selectedMovieRef.current;
      if (restoredMovie && restoredMovie.id === returnTarget.movieId) {
        detailPopupOpenRef.current = true;
        setDetailPopup({ open: true, movie: restoredMovie, originItemId: restoredMovie.id });
        setMoviesBrowseUiFrozenForDetail(true);
      }
      isRestoringPlaybackFocusRef.current = false;
      logMoviesPlaybackReturn({
        origin: returnTarget.kind,
        movieId: returnTarget.movieId,
        detailWasOpen: true,
        detailRestored: Boolean(restoredMovie && restoredMovie.id === returnTarget.movieId),
        focusTarget: returnTarget.detailFocusTarget,
      });
      if (returnTarget.kind === 'search-detail') {
        setSearchPhase('detail-open');
        searchPhaseRef.current = 'detail-open';
        detailSourceRef.current = 'search';
        setDetailSource('search');
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
      }
      if (isOnnMoviesTraceEnabled()) {
        traceOnnMoviesEvent('Playback', 'playback_detail_revealed', {
          kind: returnTarget.kind,
          movieId: returnTarget.movieId,
          detailFocusPhase: 'detail-open',
          detailOpen: true,
          playbackActive: false,
          marker: MOVIES_FOCUS_STAGE4G_MARKER,
        });
      }
      return;
    }

    if (returnTarget?.kind === 'browse') {
      logMoviesPlaybackReturn({
        origin: 'browse',
        movieId: returnTarget.movieId,
        detailWasOpen: false,
        detailRestored: false,
        focusTarget: null,
      });
      if (isOnnMoviesTraceEnabled()) {
        traceOnnMoviesEvent('Playback', 'playback_returning_to_browse', {
          movieId: returnTarget.movieId,
          categoryId: returnTarget.categoryId,
          marker: MOVIES_FOCUS_STAGE4G_MARKER,
        });
      }
      setDetailOpen(false);
      detailOpenRef.current = false;
      setDetailFocusPhaseSafe('browse');
      isRestoringPlaybackFocusRef.current = false;
      return;
    }

    // Legacy / missing target: never treat player close as detail-close.
    if (detailOpenRef.current || detailFocusPhaseRef.current === 'detail-open') {
      if (isOnnMoviesTraceEnabled()) {
        traceOnnMoviesEvent('Playback', 'playback_return_violation', {
          reason: 'missing-return-target-kept-detail-open',
          detailOpen: detailOpenRef.current,
          detailFocusPhase: detailFocusPhaseRef.current,
          marker: MOVIES_FOCUS_STAGE4G_MARKER,
        });
      }
      detailOpenRef.current = true;
      setDetailOpen(true);
      setDetailFocusPhaseSafe('detail-open');
      isRestoringPlaybackFocusRef.current = false;
      return;
    }

    setDetailOpen(false);
    detailOpenRef.current = false;
    setDetailFocusPhaseSafe('browse');
    isRestoringPlaybackFocusRef.current = false;
  }, [
    activeProviderId,
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
      playbackReturnTargetRef.current = null;
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
      const launchSourceSnapshot = buildSanitizedPlaybackSourceSnapshot({
        movieId: currentMovie.id,
        streamUrl,
        containerExtension:
          matchingDetail?.containerExtension ?? currentMovie.containerExtension ?? null,
        providerId: activeProviderId,
      });
      console.info(
        '[NovaCast Movies Playback] ' +
          JSON.stringify({
            event: 'movies_playback_launch_source_snapshot',
            marker: MOVIES_FOCUS_STAGE4L1_MARKER,
            ...launchSourceSnapshot,
          }),
      );
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
      // Stage 4.2G: save explicit return target; keep Detail logically open.
      if (fromSearch) {
        playbackReturnTargetRef.current = createMoviesSearchDetailPlaybackReturnTarget({
          movieId: currentMovie.id,
          searchQuery: searchQueryForSelectionRef.current,
          detailFocusTarget: 'play',
        });
      } else if (detailOpenRef.current || detailPopupOpenRef.current) {
        playbackReturnTargetRef.current = createMoviesDetailPlaybackReturnTarget({
          movieId: currentMovie.id,
          categoryId: selectedCategoryId,
          detailFocusTarget: 'play',
        });
        // Keep detailOpen + detail-open phase; only hide behind the player.
        setDetailFocusPhaseSafe('detail-open');
      } else {
        playbackReturnTargetRef.current = createMoviesBrowsePlaybackReturnTarget({
          movieId: currentMovie.id,
          categoryId: selectedCategoryId,
        });
      }
      if (isOnnMoviesTraceEnabled()) {
        const target = playbackReturnTargetRef.current;
        traceOnnMoviesEvent('Playback', 'playback_return_target_saved', {
          kind: target?.kind ?? null,
          movieId: currentMovie.id,
          categoryId: selectedCategoryId,
          detailOpen: detailOpenRef.current,
          detailFocusPhase: detailFocusPhaseRef.current,
          marker: MOVIES_FOCUS_STAGE4G_MARKER,
        });
      }
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
          containerExtension:
            matchingDetail?.containerExtension ?? currentMovie.containerExtension,
          videoCodec: matchingDetail?.videoCodec,
          videoWidth: matchingDetail?.videoWidth,
          videoHeight: matchingDetail?.videoHeight,
          directSourceUrl: matchingDetail?.directSource,
        },
        {
          launchSource: 'play',
          // Preserve the complete movie frame, including credits and edge content.
          // Series and Search playback already use the shared contain behavior.
          contentFit: 'contain',
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
      const httpStatus = extractPlaybackHttpStatus(error);
      const failureCategory = normalizePlaybackFailure(error);
      const errorSnapshot = buildSanitizedPlaybackSourceSnapshot({
        movieId: requestedMovie.id,
        streamUrl: null,
        containerExtension: requestedMovie.containerExtension ?? null,
        providerId: activeProviderId,
        httpResponseCode: httpStatus,
      });
      console.info(
        '[NovaCast Movies Playback] ' +
          JSON.stringify({
            event: 'movies_playback_http_source_error',
            marker: MOVIES_FOCUS_STAGE4L1_MARKER,
            failureCategory,
            ...errorSnapshot,
          }),
      );
      logMoviesPlayback('launch-failed', {
        movieId: requestedMovie.id,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorMessage: error instanceof Error ? error.message : String(error),
        httpStatus,
        failureCategory,
      });

      setLaunchingPlayback(false);
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
    selectedCategoryId,
    setDetailFocusPhaseSafe,
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
      detailLaunchOriginRef.current = 'search';
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
      closeCommitTokenRef.current = null;
      closeTransactionRef.current = null;
      searchReturnPendingRef.current = false;
      setSearchReturnPending(false);
      setMoviesBrowseUiFrozenForDetail(true);
      setDetailOpen(true);
      setDetailFocusPhaseSafe('detail-open');
      // Stage 4.2N — same simple popup state as the browse-origin open path.
      detailPopupOpenRef.current = true;
      setDetailPopup({ open: true, movie, originItemId: meta.searchFocusedMovieId });
      setV2CloseFocusTargetId(null);
      logMovieDetailPopupV2Event('movie_detail_popup_v2_active', {
        movieId: movie.id,
        origin: 'search',
      });
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
      logMoviesDetailV2FocusOwnership({
        phase: 'detail-open',
        movieId: movie.id,
        detailOpen: true,
        focusIssued: false,
        detailCtaHandlePresent: false,
        focusedRegion: 'detail',
        categoryHostFocusable: false,
        posterHostFocusable: false,
      });
      logMoviesDetailV2FocusOwnership({
        phase: 'background-focus-disabled',
        movieId: movie.id,
        detailOpen: true,
        focusIssued: false,
        detailCtaHandlePresent: false,
        focusedRegion: 'detail',
        categoryHostFocusable: false,
        posterHostFocusable: false,
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

  // Stage 4.2L.2: when Detail is fully closed, no gray cover / isolation may remain.
  useEffect(() => {
    if (detailOpen || detailClosing) {
      return;
    }
    const invariant = assertMoviesDetailClosedVisualInvariant({
      detailOpen,
      detailClosing,
      overlayVisible: detailOverlayVisible,
      visualIsolationActive,
      holdCoverActive: detailVisualHold || focusHandoffActive,
      browsePointerEventsEnabled: !playbackUiActive && !searchBlocksBrowse,
    });
    if (!invariant.ok) {
      cleanupDetailCloseVisualState({
        forced: true,
        token: visualIsolationTokenRef.current,
        reason: `closed-invariant:${invariant.violations.join(',')}`,
      });
      setVisualIsolationSafe(false);
      setDetailVisualHoldSafe(false);
      console.info(
        '[NovaCast Movies Focus] ' +
          JSON.stringify({
            event: 'movies_detail_closed_visual_invariant_enforced',
            marker: MOVIES_FOCUS_STAGE4L2_MARKER,
            violations: invariant.violations,
          }),
      );
    }
  }, [
    cleanupDetailCloseVisualState,
    detailClosing,
    detailOpen,
    detailOverlayVisible,
    detailVisualHold,
    focusHandoffActive,
    playbackUiActive,
    searchBlocksBrowse,
    setDetailVisualHoldSafe,
    setVisualIsolationSafe,
    visualIsolationActive,
  ]);

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
      if (isPlaybackResumePromptOpen()) {
        logResumeInputAudit({
          eventType: 'select',
          resumePromptOpen: true,
          categoryHandlerReceived: true,
          categoryIndexBefore: selectedCategoryId,
          categoryIndexAfter: selectedCategoryId,
        });
        return;
      }
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
    [selectCategory, selectedCategoryId],
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
    () =>
      resolveContinueWatchingLabel(
        continueWatchingEntry?.progressPercent,
        continueWatchingEntry?.positionMs,
        continueWatchingEntry?.durationMs,
      ),
    [continueWatchingEntry?.durationMs, continueWatchingEntry?.positionMs, continueWatchingEntry?.progressPercent],
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
  // media-category-hero-standard-v1
  // Every category first-page load uses the hero spaceship loader.
  // The inline Loading more movies pill remains pagination-only.
  const primaryLoaderVisible = gateVisible || primaryHoldVisible || categoryLoading;
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
    areMoviesPostersNormallyFocusable(detailFocusPhase) &&
    !playbackUiActive &&
    !searchBlocksBrowse &&
    backgroundTvFocusEnabled;
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
        <Text style={styles.primaryLoaderLabel} numberOfLines={2}>
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
          // Stage 4.2L.2: when Detail is fully closed, browse always owns pointer events.
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
        navigationFocusable={chromeFocusable && !searchBlocksBrowse && backgroundTvFocusEnabled}
        compactNavigationRail>
        <View style={styles.screen}>
          <View style={styles.topBar}>
            <MovieToolbar
              focusable={chromeFocusable && !searchBlocksBrowse && backgroundTvFocusEnabled}
              hasTVPreferredFocus={false}
              buttonRef={searchToolbarRef}
              discoverButtonRef={discoverToolbarRef}
              searchNextFocusRight={discoverToolbarFocusHandle}
              discoverNextFocusLeft={searchToolbarFocusHandle}
              discoverNextFocusRight={sortFocusRightHandle}
              onSearchFocus={() => {
                // Stage 4.2L.2: Search may log unexpected focus but must NEVER call
                // requestTvFocus / fight native focus (fatal on Android TV).
                actualFocusedComponentRef.current = 'MovieToolbar.Search';
                if (restoreTimingRef.current) {
                  restoreTimingRef.current.searchFocusAttempted = true;
                }
                const browseCloseActive =
                  detailClosing ||
                  restoringBrowseFocus ||
                  postRestoreActive ||
                  isMoviesDetailClosingPhase(detailFocusPhase);
                const closeToken =
                  detailFocusTokenRef.current?.token ??
                  postRestoreLatchRef.current?.token ??
                  null;
                console.info(
                  '[NovaCast Movies Focus] ' +
                    JSON.stringify({
                      event: 'movies_toolbar_search_focus_eligibility_changed',
                      marker: MOVIES_FOCUS_STAGE4L2_MARKER,
                      searchPreferredFocus: false,
                      toolbarPreferredFocus: toolbarSearchPreferredAllowed,
                      detailPhase: detailFocusPhase,
                      closeToken,
                      immutablePosterMovieId: getImmutableCloseTargetMovieId(),
                      startupOwnershipActive: startupFocusOwnershipActiveRef.current,
                      restoringBrowseFocus,
                      postRestoreLatchActive: postRestoreActive,
                    }),
                );
                if (browseCloseActive || startupFocusOwnershipActiveRef.current) {
                  console.info(
                    '[NovaCast Movies Focus] ' +
                      JSON.stringify({
                        event: 'movies_toolbar_search_focus_steal_violation',
                        marker: MOVIES_FOCUS_STAGE4L2_MARKER,
                        detailPhase: detailFocusPhase,
                        closeToken,
                        immutablePosterMovieId: getImmutableCloseTargetMovieId(),
                        currentlyFocusedTarget: 'MovieToolbar.Search',
                        startupOwnershipActive: startupFocusOwnershipActiveRef.current,
                        restoringBrowseFocus,
                        postRestoreLatchActive: postRestoreActive,
                        searchPreferredFocus: false,
                        toolbarPreferredFocus: toolbarSearchPreferredAllowed,
                        correctionIssued: false,
                      }),
                  );
                  if (postRestoreLatchRef.current?.postRestoreActive) {
                    logMoviesSearchFocusBlocked({
                      token: postRestoreLatchRef.current.token,
                      reason: 'post-restore-latch-focusable-false-bypass',
                      source: 'MovieToolbar.onFocus',
                    });
                  }
                }
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
              onDiscoverPress={() => {
                if (searchOpen) {
                  closeSearch();
                }
                setDiscoverZoneOpen(true);
              }}
              discoverZoneOpen={discoverZoneOpen}
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
              focusable={chromeFocusable && !searchBlocksBrowse && backgroundTvFocusEnabled}
              railInstanceId={railInstanceIdRef.current}
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
                  focusable={backgroundTvFocusEnabled && !detailOpen && !playbackUiActive}
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
                  style={styles.gridStage}
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
                    closingFocusMovieId={effectiveClosingFocusMovieId}
                    postRestorePreferredMovieId={postRestorePreferredMovieId}
                    pinnedHighlightMovieId={pinnedHighlightMovieId}
                    lockScrollForFocusRestore={lockScrollForFocusRestore}
                    snapshotTargetWasVisible={snapshotTargetWasVisible}
                    viewportRestoreCommand={viewportRestoreCommand}
                    allowOffscreenInitialRestore={allowOffscreenInitialRestore}
                    onFocusMovie={handleFocusMovie}
                    onSelectMovie={handleSelectMovie}
                    registerPosterRef={handleRegisterPosterRef}
                    sortOption={sortOption}
                    onSortChange={setSort}
                    showRatingSort={categoryHasRatings}
                    isDiscover={isDiscoverCategory}
                    sortFocusLeftHandle={discoverToolbarFocusHandle ?? searchToolbarFocusHandle ?? categoryFocusLeftHandle}
                    onSortFocusHandleReady={setSortFocusRightHandle}
                    sortFocusable={chromeFocusable && !searchBlocksBrowse && backgroundTvFocusEnabled}
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
                    listOverlays={paginationLoaderNode}
                  />
                  {/* media-category-hero-layout-v2: category hero stays outside the clipped poster-list viewport. */}
                  {primaryLoaderNode}
                </View>
              ) : (
                <View style={styles.gridStage}>{primaryLoaderNode}</View>
              )}
            </View>

          </View>
        </View>
      </NovaTvShell>
      </View>

      <MovieDetailPopupV2
        visible={detailPopup.open && !playbackUiActive}
        movie={detailPopup.movie}
        // Stage 4.2N: brand-new popup, own state, own close path — no legacy overlay.
        detail={
          detailPopup.movie
            ? movieDetail?.id === detailPopup.movie.id
              ? movieDetail
              : buildMoviePreviewDetail(detailPopup.movie)
            : null
        }
        loading={detailLoading}
        error={detailError}
        playLabel={continueWatchingLabel}
        isFavorite={detailPopup.movie ? library.isFavorite(detailPopup.movie.id) : false}
        isWatchlisted={detailPopup.movie ? library.isWatchlisted(detailPopup.movie.id) : false}
        onClose={(source) => closeMovieDetailPopupV2(source)}
        onPlay={detailPopup.movie ? startPlayback : undefined}
        onRetry={detailPopup.movie ? handleDetailRetry : undefined}
        onTrailerPress={
          movieDetail?.trailerUrl
            ? () => {
                void Linking.openURL(movieDetail.trailerUrl!);
              }
            : undefined
        }
        onToggleFavorite={
          detailPopup.movie
            ? () => {
                void toggleFavorite(activeProviderId, detailPopup.movie!.id);
              }
            : undefined
        }
        onToggleWatchlist={
          detailPopup.movie
            ? () => {
                void toggleWatchlist(activeProviderId, detailPopup.movie!.id);
              }
            : undefined
        }
        originItemId={detailPopup.originItemId}
      />
        </>

      <DiscoverZoneOverlay
        visible={discoverZoneOpen && !playbackUiActive && !detailPopup.open}
        retainMounted={discoverZoneOpen}
        restoreFocusItemId={discoverZoneRestoreItemId}
        providerId={activeProviderId}
        scope="movies"
        onClose={() => {
          detailLaunchOriginRef.current = 'browse';
          setDiscoverZoneRestoreItemId(null);
          setDiscoverZoneOpen(false);
        }}
        onSelectItem={(item) => {
          if (!item.canonicalMovie) {
            return;
          }
          setDiscoverZoneRestoreItemId(item.id);
          handleSelectMovie(item.canonicalMovie, DISCOVERY_ZONE_ORIGIN);
        }}
      />
      <SearchOverlay
        visible={searchOverlayVisible && !playbackUiActive}
        // Keep Search controller/results alive across Detail + playback (no Modal while hidden).
        retainMounted={searchOpen && !playbackUiActive}
        restoreFocusMovieId={searchPhase === 'returning' ? searchRestoreMovieId : null}
        onRestoreFocusHandled={() => {
          if (searchPhaseRef.current !== 'returning') {
            return;
          }
          const tx = closeTransactionRef.current;
          const token = tx?.token ?? detailFocusTokenRef.current?.token ?? null;
          if (
            token &&
            shouldDropMoviesDetailCloseCallback({
              activeToken: detailFocusTokenRef.current?.token ?? tx?.token,
              callbackToken: token,
              revealCommitted: tx?.revealCommitted,
              commitToken: closeCommitTokenRef.current,
            })
          ) {
            if (isOnnMoviesTraceEnabled()) {
              traceOnnMoviesEvent('Overlay', 'detail_close_stale_callback_dropped', {
                token,
                origin: 'search',
                marker: MOVIES_FOCUS_STAGE4J_MARKER,
              });
            }
            return;
          }
          if (token && closeCommitTokenRef.current !== token) {
            const commit = tryCommitMoviesDetailCloseReveal({
              transaction: closeTransactionRef.current,
              token,
            });
            if (commit.ok) {
              closeCommitTokenRef.current = token;
              closeTransactionRef.current = commit.transaction;
              if (isOnnMoviesTraceEnabled()) {
                traceOnnMoviesEvent('Overlay', 'detail_close_commit_once', {
                  token,
                  source: commit.transaction.source,
                  origin: 'search',
                  movieId: searchRestoreMovieId,
                  marker: MOVIES_FOCUS_STAGE4J_MARKER,
                });
                traceOnnMoviesEvent('Overlay', 'detail_close_search_revealed', {
                  token,
                  source: commit.transaction.source,
                  origin: 'search',
                  movieId: searchRestoreMovieId,
                  elapsedMs: Date.now() - commit.transaction.startedAt,
                  marker: MOVIES_FOCUS_STAGE4J_MARKER,
                });
              }
            } else if (isOnnMoviesTraceEnabled()) {
              traceOnnMoviesEvent('Overlay', 'detail_close_duplicate_commit_blocked', {
                token,
                reason: commit.reason,
                origin: 'search',
                marker: MOVIES_FOCUS_STAGE4J_MARKER,
              });
              return;
            }
          }
          // Reveal Search only after result focus path settled; unmount Detail once.
          const finishedSource =
            closeTransactionRef.current?.source ?? detailCloseSourceRef.current;
          searchReturnPendingRef.current = false;
          setSearchReturnPending(false);
          cleanupDetailCloseVisualState({
            forced: true,
            token,
            reason: 'search-return',
          });
          setDetailOpen(false);
          detailOpenRef.current = false;
          setDetailSuppressedForPlayback(false);
          setDetailFocusPhaseSafe('browse');
          setClosingFocusMovieId(null);
          setRestoringBrowseFocus(false);
          setFocusSuppressionHeld(false);
          setPreserveXCloseFocus(false);
          xCloseActivationLockRef.current = resetMoviesDetailXCloseActivationLock();
          setXCloseActivationLocked(false);
          detailFocusTokenRef.current = null;
          setMoviesBrowseUiFrozenForDetail(false);
          flushDeferredBrowseCommits();
          setSearchPhase('open-results');
          searchPhaseRef.current = 'open-results';
          if (isOnnMoviesTraceEnabled() && token) {
            traceOnnMoviesEvent('Overlay', 'detail_close_transaction_finished', {
              token,
              source: finishedSource,
              origin: 'search',
              movieId: searchRestoreMovieId,
              marker: MOVIES_FOCUS_STAGE4J_MARKER,
            });
          }
          closeTransactionRef.current = null;
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
      position: 'relative',
      paddingTop: 0,
      gap: 6,
    },
    topBar: {
      position: 'absolute',
      top: 0,
      right: 220,
      zIndex: 4,
      minHeight: 36,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    headingBlock: {
      flex: 1,
      minWidth: 0,
    },
    heading: {
      color: theme.colors.textPrimary,
      fontSize: 28,
      fontWeight: '800',
      letterSpacing: -0.4,
    },
    copy: {
      marginTop: 1,
      color: theme.colors.textSecondary,
      fontSize: 13,
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
      position: 'absolute',
      top: 50,
      left: 0,
      right: 0,
      bottom: 0,
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
    // media-category-hero-series-parity-v4
    // Match Series category-loader vertical geometry while staying outside MoviePosterGrid clipping.
    primaryLoaderContent: {
      position: 'absolute',
      top: '42%',
      left: 12,
      right: 12,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      backgroundColor: 'transparent',
      borderWidth: 0,
      transform: [{ translateY: -52 }],
    },
    primaryLoaderLabel: {
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
