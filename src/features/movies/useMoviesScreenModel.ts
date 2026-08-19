import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useProviderStore } from '@/features/providers/providerStore';
import { useActiveProviderBundle } from '@/features/providers/useActiveProviderBundle';

import type { MovieDataSource } from './data/MovieDataSource';
import {
  createSqliteMovieDataSource,
  requestSqliteMovieCategoriesFullRefresh,
} from './data/SqliteMovieDataSource';
import { createMovieFirstRunPresentationBridge } from './data/movieFirstRunPresentationBridge';
import { MOVIE_PAGE_SIZE } from './movieMockData';
import type { MovieCategory, MovieSummary } from './movieTypes';
import type { MovieDetailEnrichmentOrigin } from './movieDetailEnrichment';
import { resolvePlaybackMovieId, resolveSelectedMovie, type MoviesLoadStatus } from './moviesScreenLogic';
import { getMoviesScreenMemory, rememberMoviesScreenMemory } from './moviesScreenMemory';
import {
  createSmartMovieDataSource,
  refreshSmartCategoryCounts,
} from './smart/SmartMovieDataSource';
import {
  ALL_MOVIES_CATEGORY_ID,
  getVisibleMovieCategories,
  logMoviesInitialCategory,
  resolveMoviesInitialCategory,
} from './moviesVisibleCategories';
import {
  isMoviesCatalogNotReadyError,
  resolveMoviesCatalogReadiness,
} from './moviesCatalogReadiness';
import {
  clearMoviesSparseRepairSchedule,
  isMoviesCatalogRepairing,
  setMoviesCatalogRepairingUi,
} from './moviesSparseCatalogRepair';
import { subscribeMovieLibrary } from './smart/movieLibraryStore';
import {
  getMoviesSettingsSync,
  setMovieSortOption,
  subscribeMoviesSettings,
  useMoviesSettingsStore,
} from './smart/moviesSettingsStore';
import type { ContentSortOption } from '@/features/media-browser/contentSorting';
import { buildContentSortRequestKey } from '@/features/media-browser/contentSortRequest';
import { buildMoviePreviewDetail } from '@/features/media-browser/mediaDetail';
import type { MediaDetail } from '@/features/media-browser/mediaTypes';
import { subscribeCategoryCountIndex, getCategoryCountFromIndex } from '@/features/providers/categoryCountIndexStore';
import {
  subscribeCatalogSyncPhase,
  subscribeMovieCatalogReady,
  subscribeMovieCategoriesUpdated,
} from '@/features/providers/providerCatalogSync';
import {
  getCatalogBootstrapState,
  resolveReadableCatalogGeneration,
} from '@/features/catalog/catalogRepository';
import { subscribeSmartCategoryCache } from '@/features/providers/smartCategoryCacheStore';
import { isSmartCategoryId, normalizeSelectedSmartCategoryId } from '@/features/media-browser/mediaCategoryUtils';
import {
  getOnnMoviesGridInstanceId,
  isOnnMoviesGridMounted,
  isOnnMoviesTraceEnabled,
  traceOnnMoviesCategoriesCleared,
  traceOnnMoviesEvent,
} from '@/features/diagnostics/onnMoviesTrace';
import {
  bumpMoviesBrowseListRevision,
  getMoviesDetailOpenForDiagnostics,
  isMoviesBrowseUiFrozenForDetail,
  resetMoviesBrowsePresentationLatches,
} from './moviesDiagnosticsState';
import {
  logMoviesPageCommit,
  logMoviesRecovery,
  nextMoviesPresentationInstance,
  resolveMoviesPageCommitDecision,
} from './moviesPageCommit';
import {
  describeMoviesDeferredBrowseCommit,
  type MoviesDeferredBrowseCommitKind,
} from './moviesDetailCloseTransaction';
import {
  categoriesNeedingCountWarm,
  createSerialCategoryCountQueue,
  shouldNetworkFetchCategoryCountOnWarm,
  shouldPrefetchMovieCategoryCount,
} from './movieCategoryCountPolicy';
import {
  evaluateMoviesStartupBudgets,
  MOVIES_FOCUS_STAGE4L_MARKER,
  MOVIES_STARTUP_VIEWPORT_LIMIT,
  resolveMoviesStartupFocusTarget,
  shouldDeferMoviesBackgroundGenerationSwap,
  shouldRunMoviesStartupBackgroundWork,
  type MoviesStartupQueryMode,
  type MoviesStartupReadinessLevel,
} from './moviesStartupFastPath';
import {
  beginMoviesStartupSession,
  getMoviesStartupSession,
  markMoviesStartupSessionInteractive,
  MOVIES_FOCUS_STAGE4L1_MARKER,
  shouldBlockMoviesStartupReentry,
  shouldDropLateMoviesStartupFocusResult,
} from './moviesStartupRuntimeIsolation';

const MOVIES_SQLITE_READS_ENABLED =
  process.env.EXPO_PUBLIC_MOVIES_SQLITE_READS === 'true';

export type MoviesScreenModelOptions = {
  initialSelectedCategoryId?: string;
  initialFocusedMovieId?: string | null;
  initialSelectedMovieId?: string | null;
};

function uniqueMovies(existing: MovieSummary[], incoming: MovieSummary[]) {
  const seen = new Set(existing.map((movie) => movie.id));
  return [...existing, ...incoming.filter((movie) => !seen.has(movie.id))];
}

function logMoviesAction(action: string, payload: Record<string, unknown> = {}) {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.info('[NovaCast Movies UI]', { action, ...payload });
  }
}

function logMoviesPerf(action: string, payload: Record<string, unknown> = {}) {
  console.info('[NovaCast Movies]', { action, ...payload });
}

function applyIndexedProviderCounts(providerId: string, categories: MovieCategory[]): MovieCategory[] {
  let changed = false;
  const next = categories.map((category) => {
    if (category.kind !== 'provider' || category.countKnown) {
      return category;
    }
    const indexed = getCategoryCountFromIndex(providerId, 'movie', category.id);
    // Never adopt a stale index zero over an unresolved count (placeholder stays "...").
    if (indexed == null || indexed <= 0) {
      return category;
    }
    changed = true;
    return { ...category, count: indexed, countKnown: true };
  });
  return changed ? next : categories;
}

function applyCategoryCount(categories: MovieCategory[], categoryId: string, count: number) {
  return categories.map((category) => (category.id === categoryId ? { ...category, count, countKnown: true } : category));
}

function mergeCategoriesPreservingCounts(previous: MovieCategory[], next: MovieCategory[]) {
  if (!next.length && previous.length) {
    const previousHasRealProvider = previous.some(
      (category) => category.kind === 'provider' && category.id !== 'all',
    );
    // Allow clear when previous had no real provider categories (e.g. pending/empty).
    if (previousHasRealProvider) {
      return previous;
    }
    return next;
  }
  if (!previous.length) {
    return next;
  }

  const previousProvider = previous.filter((category) => category.kind === 'provider' && category.id !== 'all');
  const nextProvider = next.filter((category) => category.kind === 'provider' && category.id !== 'all');
  const previousAll = previous.find((category) => category.id === 'all');
  const nextAll = next.find((category) => category.id === 'all');
  const previousTotal = previousAll?.count ?? 0;
  const nextTotal = nextAll?.count ?? 0;

  // A late smart-count/category refresh must not erase a valid provider rail.
  // Treat a zero, collapsed, or implausibly small result as a rejected refresh.
  const looksCollapsedProviderRail =
    previousProvider.length >= 8 &&
    nextProvider.length > 0 &&
    nextProvider.length <= 2 &&
    nextProvider.length < previousProvider.length * 0.25;

  if (
    (previousProvider.length > 0 && nextProvider.length === 0) ||
    looksCollapsedProviderRail ||
    (previousTotal > 0 && nextTotal > 0 && nextTotal < previousTotal * 0.25)
  ) {
    console.info(
      '[NovaCast Movies Category Refresh Rejected] ' +
        JSON.stringify({
          readableGeneration: null,
          previousProviderCount: previousProvider.length,
          nextProviderCount: nextProvider.length,
          previousTotal,
          nextTotal,
          previousCategoryCount: previous.length,
          nextCategoryCount: next.length,
          reason:
            nextProvider.length === 0
              ? 'zero-provider-categories'
              : looksCollapsedProviderRail
                ? 'collapsed-provider-rail'
                : 'suspiciously-tiny-total',
        }),
    );
    return previous;
  }

  const previousById = new Map(previous.map((category) => [category.id, category]));

  return next.map((category) => {
    const prior = previousById.get(category.id);
    if (!prior) {
      return category;
    }

    if (prior.countKnown && !category.countKnown) {
      return { ...category, count: prior.count, countKnown: true };
    }

    if (prior.countKnown && category.countKnown && prior.count > category.count) {
      return { ...category, count: prior.count };
    }

    return category;
  });
}

export function useMoviesScreenModel(
  dataSource?: MovieDataSource,
  options: MoviesScreenModelOptions = {},
) {
  const { selectedProvider } = useProviderStore();
  const { bundle: activeBundle } = useActiveProviderBundle();
  const activeProviderId = selectedProvider?.id ?? 'demo-provider';
  const settings = useMoviesSettingsStore();
  const sortOption = settings.movieSortOption;
  const detailOriginRef = useRef<MovieDetailEnrichmentOrigin>('browse');
  const [firstRunBridgeEligible, setFirstRunBridgeEligible] = useState(false);
  const [firstRunBridgeProviderId, setFirstRunBridgeProviderId] = useState<string | null>(null);
  const firstRunBridgeEligibleRef = useRef(false);
  const bridgeHandoffPendingRef = useRef(false);
  const resolvedDataSource = useMemo(() => {
    if (dataSource) {
      return dataSource;
    }

    if (MOVIES_SQLITE_READS_ENABLED && selectedProvider?.id) {
      console.info('[Movies SQLite] selected', {
        providerId: selectedProvider.id,
      });
      const providerMovies = activeBundle?.movies;
      if (
        firstRunBridgeEligible &&
        firstRunBridgeProviderId === selectedProvider.id &&
        providerMovies
      ) {
        return createMovieFirstRunPresentationBridge(selectedProvider.id, providerMovies);
      }
      return createSmartMovieDataSource(
        createSqliteMovieDataSource(selectedProvider.id, {
          fetchProviderMovieInfo: providerMovies?.getMovieInfo
            ? (movieId) => providerMovies.getMovieInfo!(movieId)
            : undefined,
          getDetailOrigin: () => detailOriginRef.current,
        }),
        selectedProvider.id,
      );
    }

    if (activeBundle?.movies) {
      return activeBundle.movies;
    }

    return null;
  }, [
    activeBundle?.movies,
    dataSource,
    firstRunBridgeEligible,
    firstRunBridgeProviderId,
    selectedProvider?.id,
  ]);
  const providerMemory = getMoviesScreenMemory(activeProviderId);
  const [categories, setCategories] = useState<MovieCategory[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState(
    normalizeSelectedSmartCategoryId(options.initialSelectedCategoryId ?? providerMemory.selectedCategoryId) ?? '',
  );
  const [visibleMovies, setVisibleMovies] = useState<MovieSummary[]>([]);
  const visibleMoviesRef = useRef<MovieSummary[]>([]);
  const presentationInstanceRef = useRef(nextMoviesPresentationInstance());
  const [focusedMovieId, setFocusedMovieId] = useState<string | null>(
    options.initialFocusedMovieId ?? providerMemory.focusedMovieId,
  );
  const [selectedMovieId, setSelectedMovieId] = useState<string | null>(
    options.initialSelectedMovieId ?? providerMemory.selectedMovieId,
  );
  const [selectedMovieSnapshot, setSelectedMovieSnapshot] = useState<MovieSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [loadStatus, setLoadStatus] = useState<MoviesLoadStatus>('loading');
  const [catalogRepairing, setCatalogRepairing] = useState(false);
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [searchQuery, setSearchQueryState] = useState('');
  const [movieDetail, setMovieDetail] = useState<MediaDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [categoryHasRatings, setCategoryHasRatings] = useState(true);
  /** Stage 3E.2/3E.3: first-page readiness gate for primary loader lifetime (observe-only). */
  const [firstPageLoadGate, setFirstPageLoadGate] = useState(() => ({
    loadingCategoryId: null as string | null,
    loadingRequestToken: null as string | null,
    firstPageResolvedCategoryId: null as string | null,
  }));

  const offsetRef = useRef(0);
  const requestGenerationRef = useRef(0);
  const loadStatusRef = useRef<MoviesLoadStatus>(loadStatus);
  loadStatusRef.current = loadStatus;
  const focusedMovieIdRef = useRef<string | null>(null);
  const categoryCountGenerationRef = useRef(0);
  const categoryCountQueueRef = useRef<ReturnType<typeof createSerialCategoryCountQueue> | null>(null);
  const detailRequestIdRef = useRef(0);
  const [reloadToken, setReloadToken] = useState(0);
  /** Stage 4.2E: skip the follow-up page effect after an atomic generation swap. */
  const atomicBrowseCommitRef = useRef<{ categoryId: string; generation: number } | null>(null);
  /** Stage 4.2J: UI commits deferred while Detail owns / closes the screen. */
  const deferredBrowseCommitsRef = useRef<
    Array<{ kind: MoviesDeferredBrowseCommitKind; apply: () => void; focusedMovieId: string | null }>
  >([]);
  /** Stage 4.2L: Movies route mount clock + readiness (interactive before provider refresh). */
  const routeMountedAtRef = useRef(Date.now());
  const startupStateRef = useRef({
    level: 'shell' as MoviesStartupReadinessLevel,
    durableCategoriesReady: false,
    firstViewportReady: false,
    interactive: false,
    backgroundRefreshStarted: false,
    backgroundRefreshFinished: false,
    categoriesElapsedMs: null as number | null,
    firstViewportElapsedMs: null as number | null,
    interactiveElapsedMs: null as number | null,
    startupMode: 'unavailable' as MoviesStartupQueryMode,
    categoryReplacements: 0,
    movieReplacements: 0,
    budgetEmitted: false,
    pendingSmartCountRefresh: false,
  });
  const [startupInteractive, setStartupInteractive] = useState(false);

  const emitMoviesStartup = useCallback(
    (event: string, payload: Record<string, unknown> = {}) => {
      const body = {
        event,
        marker: MOVIES_FOCUS_STAGE4L_MARKER,
        providerId: activeProviderId,
        elapsedMs: Date.now() - routeMountedAtRef.current,
        ...payload,
      };
      console.info('[NovaCast Movies Startup] ' + JSON.stringify(body));
      if (isOnnMoviesTraceEnabled()) {
        traceOnnMoviesEvent('Startup', event, body);
      }
    },
    [activeProviderId],
  );

  useEffect(() => {
    if (dataSource || !selectedProvider?.id || !MOVIES_SQLITE_READS_ENABLED) {
      firstRunBridgeEligibleRef.current = false;
      return;
    }

    let mounted = true;
    const providerId = selectedProvider.id;
    const refreshBridgeEligibility = async (reason: string) => {
      const [state, readableGeneration] = await Promise.all([
        getCatalogBootstrapState(providerId, 'movie').catch(() => null),
        resolveReadableCatalogGeneration(providerId, 'movie').catch(() => 0),
      ]);
      if (!mounted) {
        return;
      }

      const eligible = Boolean(
        state &&
          readableGeneration <= 0 &&
          state.durableReadyGeneration <= 0 &&
          state.currentAttemptGeneration === 1 &&
          state.currentStatus === 'syncing',
      );
      console.info('[NovaCast Movies First Run Bridge]', JSON.stringify({
        event: 'bridge-eligibility-check',
        providerId,
        currentAttemptGeneration: state?.currentAttemptGeneration ?? 0,
        currentStatus: state?.currentStatus ?? null,
        durableReadyGeneration: state?.durableReadyGeneration ?? 0,
        readableGeneration,
        eligible,
        reason,
      }));
      if (eligible && !firstRunBridgeEligibleRef.current) {
        console.info('[NovaCast Movies First Run Bridge]', JSON.stringify({
          event: 'bridge-enter',
          providerId,
          currentAttemptGeneration: state?.currentAttemptGeneration ?? 0,
          currentStatus: state?.currentStatus ?? null,
          durableReadyGeneration: state?.durableReadyGeneration ?? 0,
          readableGeneration,
          bridgeEpoch: 1,
          reason,
        }));
      } else if (!eligible && firstRunBridgeEligibleRef.current) {
        console.info('[NovaCast Movies First Run Bridge]', JSON.stringify({
          event: 'bridge-exit',
          providerId,
          readableGeneration,
          reason,
        }));
      } else if (!eligible) {
        console.info('[NovaCast Movies First Run Bridge]', JSON.stringify({
          event: 'bridge-skip',
          providerId,
          readableGeneration,
          currentAttemptGeneration: state?.currentAttemptGeneration ?? 0,
          currentStatus: state?.currentStatus ?? null,
          durableReadyGeneration: state?.durableReadyGeneration ?? 0,
          reason,
        }));
      }
      firstRunBridgeEligibleRef.current = eligible;
      setFirstRunBridgeProviderId(eligible ? providerId : null);
      setFirstRunBridgeEligible(eligible);
    };

    void refreshBridgeEligibility('initial');
    const unsubscribeSync = subscribeCatalogSyncPhase(providerId, (phase) => {
      void refreshBridgeEligibility(`sync-phase:${phase}`);
    });
    const unsubscribeReady = subscribeMovieCatalogReady(providerId, (generation) => {
      void refreshBridgeEligibility(`ready-publication:${generation}`);
    });
    return () => {
      mounted = false;
      if (firstRunBridgeEligibleRef.current) {
        console.info('[NovaCast Movies First Run Bridge]', JSON.stringify({
          event: 'bridge-provider-invalidated',
          providerId,
          reason: 'provider-or-screen-lifecycle-changed',
        }));
      }
      unsubscribeSync();
      unsubscribeReady();
    };
  }, [dataSource, selectedProvider?.id]);

  useEffect(() => {
    if (!bridgeHandoffPendingRef.current || firstRunBridgeEligible || !resolvedDataSource) {
      return;
    }
    bridgeHandoffPendingRef.current = false;
    console.info('[NovaCast Movies First Run Bridge]', JSON.stringify({
      event: 'bridge-handoff-complete',
      providerId: activeProviderId,
      datasource: 'sqlite-v2',
      reason: 'ready-generation-selected',
    }));
  }, [activeProviderId, firstRunBridgeEligible, resolvedDataSource]);

  const markStartupInteractiveIfReady = useCallback(() => {
    const state = startupStateRef.current;
    if (state.interactive) {
      return;
    }
    if (!state.durableCategoriesReady || !state.firstViewportReady) {
      return;
    }
    state.interactive = true;
    state.level = 'interactive';
    state.interactiveElapsedMs = Date.now() - routeMountedAtRef.current;
    markMoviesStartupSessionInteractive(activeProviderId);
    setStartupInteractive(true);
    emitMoviesStartup('movies_startup_interactive', {
      startupSessionId: getMoviesStartupSession(activeProviderId)?.sessionId ?? null,
      marker: MOVIES_FOCUS_STAGE4L1_MARKER,
      categoriesElapsedMs: state.categoriesElapsedMs,
      firstViewportElapsedMs: state.firstViewportElapsedMs,
      interactiveElapsedMs: state.interactiveElapsedMs,
      startupMode: state.startupMode,
      categoryReplacements: state.categoryReplacements,
      movieReplacements: state.movieReplacements,
    });
    if (!state.budgetEmitted) {
      state.budgetEmitted = true;
      const budgets = evaluateMoviesStartupBudgets({
        categoriesElapsedMs: state.categoriesElapsedMs,
        firstViewportElapsedMs: state.firstViewportElapsedMs,
        interactiveElapsedMs: state.interactiveElapsedMs,
        startupMode: state.startupMode,
        providerRefreshStillRunning: !state.backgroundRefreshFinished,
      });
      emitMoviesStartup('movies_startup_budget_result', {
        categoriesElapsedMs: state.categoriesElapsedMs,
        firstViewportElapsedMs: state.firstViewportElapsedMs,
        interactiveElapsedMs: state.interactiveElapsedMs,
        ...budgets,
        startupMode: state.startupMode,
        providerRefreshStillRunning: !state.backgroundRefreshFinished,
      });
    }
    if (state.pendingSmartCountRefresh) {
      state.pendingSmartCountRefresh = false;
    }
  }, [activeProviderId, emitMoviesStartup]);

  useEffect(() => {
    resetMoviesBrowsePresentationLatches();
    const sessionAlreadyInteractive = shouldBlockMoviesStartupReentry(activeProviderId);
    logMoviesRecovery({
      phase: 'component-mounted',
      componentInstance: presentationInstanceRef.current,
      sessionAlreadyInteractive,
      localPresentationHydrated: visibleMoviesRef.current.length > 0,
      readyGenerationPresent: true,
    });
    if (sessionAlreadyInteractive) {
      logMoviesRecovery({
        phase: 'sessionAlreadyInteractive',
        componentInstance: presentationInstanceRef.current,
        sessionAlreadyInteractive: true,
        localPresentationHydrated: visibleMoviesRef.current.length > 0,
        readyGenerationPresent: true,
      });
    }
    routeMountedAtRef.current = Date.now();
    const session = beginMoviesStartupSession(activeProviderId);
    startupStateRef.current = {
      level: 'shell',
      durableCategoriesReady: false,
      firstViewportReady: false,
      interactive: false,
      backgroundRefreshStarted: false,
      backgroundRefreshFinished: false,
      categoriesElapsedMs: null,
      firstViewportElapsedMs: null,
      interactiveElapsedMs: null,
      startupMode: 'unavailable',
      categoryReplacements: 0,
      movieReplacements: 0,
      budgetEmitted: false,
      pendingSmartCountRefresh: false,
    };
    setStartupInteractive(false);
    emitMoviesStartup('movies_startup_shell_mounted', {
      level: 'shell',
      startupSessionId: session.sessionId,
      marker: MOVIES_FOCUS_STAGE4L1_MARKER,
    });
    return () => {
      resetMoviesBrowsePresentationLatches();
    };
  }, [activeProviderId, emitMoviesStartup]);

  const flushDeferredBrowseCommits = useCallback(() => {
    if (isMoviesBrowseUiFrozenForDetail()) {
      return;
    }
    const pending = deferredBrowseCommitsRef.current;
    if (pending.length === 0) {
      return;
    }
    deferredBrowseCommitsRef.current = [];
    // Apply at most one consolidated update — prefer the latest commit that keeps focus.
    const focusedId = focusedMovieIdRef.current;
    let chosen = pending[pending.length - 1]!;
    for (let i = pending.length - 1; i >= 0; i -= 1) {
      const candidate = pending[i]!;
      // Probe by applying against a copy via a dry check after apply — we only know
      // post-apply. Prefer catalog-commit / list-replacement that retain focus id.
      chosen = candidate;
      break;
    }
    if (isOnnMoviesTraceEnabled()) {
      traceOnnMoviesEvent('Overlay', 'detail_close_deferred_commits_flushed', {
        count: pending.length,
        kind: chosen.kind,
        focusedMovieId: focusedId,
        marker: 'stage4j-movies-deterministic-detail-close-v1',
      });
    }
    chosen.apply();
    void focusedId;
  }, []);

  const enqueueOrApplyBrowseCommit = useCallback(
    (kind: MoviesDeferredBrowseCommitKind, apply: () => void) => {
      const decision = resolveMoviesPageCommitDecision({
        browseUiFrozenForDetail: isMoviesBrowseUiFrozenForDetail(),
        detailOpenForDiagnostics: getMoviesDetailOpenForDiagnostics(),
        currentRequestTokenMatches: true,
        selectedCategoryMatches: true,
        mounted: true,
        cancelled: false,
        rowCount: kind === 'pagination' ? 0 : 1,
        visibleCountBefore: visibleMoviesRef.current.length,
        reason: kind,
      });
      if (!decision.apply) {
        deferredBrowseCommitsRef.current.push({
          kind,
          apply,
          focusedMovieId: focusedMovieIdRef.current,
        });
        if (isOnnMoviesTraceEnabled()) {
          traceOnnMoviesEvent('Overlay', describeMoviesDeferredBrowseCommit(kind), {
            focusedMovieId: focusedMovieIdRef.current,
            pendingCount: deferredBrowseCommitsRef.current.length,
            marker: 'stage4j-movies-deterministic-detail-close-v1',
          });
        }
        return;
      }
      apply();
    },
    [],
  );

  const updateVisibleMovies = useCallback(
    (
      updater: MovieSummary[] | ((current: MovieSummary[]) => MovieSummary[]),
      reason: string,
      onApplied?: (nextLength: number) => void,
    ) => {
      const kind: MoviesDeferredBrowseCommitKind =
        reason === 'pagination-append'
          ? 'pagination'
          : reason.includes('atomic') || reason.includes('generation')
            ? 'catalog-commit'
            : 'list-replacement';
      enqueueOrApplyBrowseCommit(kind, () => {
        const current = visibleMoviesRef.current;
        const next = typeof updater === 'function' ? updater(current) : updater;
        visibleMoviesRef.current = next;
        if (kind !== 'pagination' && current !== next) {
          bumpMoviesBrowseListRevision();
        }
        console.info(
          '[NovaCast Movies Data] ' +
            JSON.stringify({
              reason,
              arrayIdentityChanged: current !== next,
              previousLength: current.length,
              nextLength: next.length,
              previousFirstId: current[0]?.id ?? null,
              nextFirstId: next[0]?.id ?? null,
              previousLastId: current[current.length - 1]?.id ?? null,
              nextLastId: next[next.length - 1]?.id ?? null,
            }),
        );
        if (isOnnMoviesTraceEnabled() && (next.length === 0 || current !== next)) {
          traceOnnMoviesEvent(
            'Catalog',
            next.length === 0 ? 'visible_movies_cleared' : 'visible_movies_replaced',
            {
              reason,
              previousLength: current.length,
              nextLength: next.length,
              selectedCategoryId: selectedCategoryIdRef.current,
              gridMounted: isOnnMoviesGridMounted(),
            },
          );
        }
        setVisibleMovies(next);
        onApplied?.(next.length);
      });
    },
    [enqueueOrApplyBrowseCommit],
  );
  const selectedCategoryIdRef = useRef(selectedCategoryId);
  selectedCategoryIdRef.current = selectedCategoryId;
  const previousListScopeRef = useRef({ providerId: '', categoryId: '' });
  const categoriesRef = useRef<MovieCategory[]>([]);
  const hideSmartCategoriesRef = useRef(settings.hideSmartCategories);
  /** Explicit selectMovie pin — survives browse page reloads for Search-origin Detail/Play. */
  const pinnedSelectedMovieIdRef = useRef<string | null>(
    options.initialSelectedMovieId ?? providerMemory.selectedMovieId,
  );

  useEffect(() => {
    categoriesRef.current = categories;
  }, [categories]);

  useEffect(() => {
    hideSmartCategoriesRef.current = settings.hideSmartCategories;
  }, [settings.hideSmartCategories]);

  const reload = useCallback(() => {
    setReloadToken((current) => current + 1);
  }, []);

  const syncCategoryCount = useCallback((categoryId: string, count: number) => {
    if (!categoryId || count < 0) {
      return;
    }

    setCategories((current) => applyCategoryCount(current, categoryId, count));
  }, []);

  useEffect(() => {
    categoryCountGenerationRef.current += 1;
    categoryCountQueueRef.current?.reset();

    if (!resolvedDataSource?.getCategoryCount) {
      categoryCountQueueRef.current = null;
      return;
    }

    const getCategoryCount = resolvedDataSource.getCategoryCount.bind(resolvedDataSource);
    categoryCountQueueRef.current = createSerialCategoryCountQueue({
      concurrency: 1,
      getGeneration: () => categoryCountGenerationRef.current,
      isAccepted: (categoryId) => {
        const category = categoriesRef.current.find((entry) => entry.id === categoryId);
        if (!category || category.countKnown) {
          return false;
        }
        return shouldPrefetchMovieCategoryCount({ categoryId, kind: category.kind });
      },
      fetchCount: getCategoryCount,
      onCount: (categoryId, count) => {
        syncCategoryCount(categoryId, count);
        logMoviesPerf('category_count_resolved', {
          categoryId,
          count,
          stats: categoryCountQueueRef.current?.getStats(),
        });
      },
    });

    logMoviesPerf('category_count_queue_ready', {
      providerId: activeProviderId,
      generation: categoryCountGenerationRef.current,
      networkWarmEnabled: shouldNetworkFetchCategoryCountOnWarm(),
    });

    return () => {
      categoryCountGenerationRef.current += 1;
      categoryCountQueueRef.current?.reset();
      categoryCountQueueRef.current = null;
    };
  }, [activeProviderId, resolvedDataSource, syncCategoryCount]);

  const prefetchCategoryCount = useCallback(
    (categoryId: string, kind?: MovieCategory['kind']) => {
      const category = categoriesRef.current.find((entry) => entry.id === categoryId);
      const resolvedKind = kind ?? category?.kind;
      if (
        !resolvedDataSource?.getCategoryCount ||
        !shouldPrefetchMovieCategoryCount({ categoryId, kind: resolvedKind }) ||
        category?.countKnown
      ) {
        return;
      }

      const queued = categoryCountQueueRef.current?.enqueue(categoryId) ?? false;
      if (queued) {
        logMoviesPerf('category_count_enqueued', {
          categoryId,
          kind: resolvedKind ?? null,
          stats: categoryCountQueueRef.current?.getStats(),
        });
      }
    },
    [resolvedDataSource],
  );

  const warmUnresolvedCategoryCounts = useCallback((nextCategories: MovieCategory[]) => {
    const unresolvedBefore = categoriesNeedingCountWarm(nextCategories);
    const withIndex = applyIndexedProviderCounts(activeProviderId, nextCategories);
    const unresolvedAfter = categoriesNeedingCountWarm(withIndex);

    logMoviesPerf('category_counts_warm_index_only', {
      providerId: activeProviderId,
      unresolvedBefore: unresolvedBefore.length,
      appliedFromIndex: unresolvedBefore.length - unresolvedAfter.length,
      leftUnresolved: unresolvedAfter.length,
      networkWarmEnabled: shouldNetworkFetchCategoryCountOnWarm(),
    });

    return withIndex;
  }, [activeProviderId]);

  const queryMode = searchQuery.trim();
  const isSearchMode = queryMode.length > 0;

  useEffect(() => {
    if (sortOption === 'rating-desc' && !categoryHasRatings) {
      void setMovieSortOption('newest');
    }
  }, [categoryHasRatings, sortOption]);

  useEffect(() => {
    if (!resolvedDataSource) {
      return;
    }

    let mounted = true;
    let indexDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    const loadCategories = async () => {
      const startedAt = Date.now();
      const categoriesBefore = categoriesRef.current.length;
      const moviesBefore = visibleMoviesRef.current.length;
      logMoviesPerf('categories_load_start', { providerId: activeProviderId });
      if (isOnnMoviesTraceEnabled()) {
        traceOnnMoviesEvent('Catalog', 'load_categories_start', {
          providerId: activeProviderId,
          categoriesBefore,
          visibleMoviesBefore: moviesBefore,
          selectedCategoryId: selectedCategoryIdRef.current,
          gridMounted: isOnnMoviesGridMounted(),
          gridInstanceId: getOnnMoviesGridInstanceId(),
        });
      }
      try {
        const nextCategories = await resolvedDataSource.getCategories();
        if (!mounted) {
          return;
        }

        const warmedCategories = warmUnresolvedCategoryCounts(nextCategories);
        const hasProviderCategories = warmedCategories.some(
          (category) => category.kind === 'provider' && category.id !== ALL_MOVIES_CATEGORY_ID,
        );

        // Stage 4.2A/C: incomplete category metadata must not become interactive.
        // Keep the loader pending; never select All Movies / arm a gen-0 page query.
        if (!hasProviderCategories) {
          const readiness =
            resolvedDataSource.sourceKind === 'sqlite'
              ? await resolveMoviesCatalogReadiness(activeProviderId)
              : null;
          if (!mounted) {
            return;
          }

          const catalogPending =
            !readiness ||
            readiness.decision === 'waiting-fresh-sync' ||
            readiness.readableItemGeneration <= 0;

          // Stage 4.2I: never blank a validated readable snapshot for background repair.
          // Full-screen repairing is only for no-valid-snapshot (catalogPending).
          const repairingWithoutSnapshot =
            isMoviesCatalogRepairing(activeProviderId) && catalogPending;
          if (isMoviesCatalogRepairing(activeProviderId) && !catalogPending) {
            // Keep existing categories / grid mounted; repair is nonblocking.
            setCatalogRepairing(false);
            setLoadStatus((current) => (current === 'error' ? current : current === 'ready' ? current : 'loading'));
            console.info(
              '[NovaCast Movies Category Contract] ' +
                JSON.stringify({
                  providerId: activeProviderId,
                  readableGeneration: readiness?.readableItemGeneration ?? null,
                  repositoryCategoryCount: nextCategories.length,
                  sqliteProviderCategoryCount: 0,
                  wrappedCategoryCount: 0,
                  appliedProviderCategoryCount: 0,
                  totalMovieCount: readiness?.readableItemCount ?? null,
                  firstProviderCategoryIds: [],
                  reason: 'snapshot-preserved-during-repair',
                }),
            );
            return;
          }

          const clearReason = repairingWithoutSnapshot
            ? 'repairing-sparse-generation'
            : catalogPending
              ? 'catalog-not-ready-categories-pending'
              : 'completed-empty-provider-rail';
          traceOnnMoviesCategoriesCleared(clearReason, {
            providerId: activeProviderId,
            categoriesBefore,
            categoriesAfter: 0,
            visibleMoviesBefore: moviesBefore,
            readableGeneration: readiness?.readableItemGeneration ?? null,
            syncingGeneration: readiness?.syncingGeneration ?? null,
            decision: readiness?.decision ?? null,
            detailOpen: getMoviesDetailOpenForDiagnostics(),
            gridMounted: isOnnMoviesGridMounted(),
          });
          setCategories([]);
          setSelectedCategoryId('');
          setLoadErrorMessage(null);
          if (catalogPending || repairingWithoutSnapshot) {
            setCatalogRepairing(repairingWithoutSnapshot);
            setLoadStatus((current) => (current === 'error' ? current : 'loading'));
            console.info(
              '[NovaCast Movies Category Contract] ' +
                JSON.stringify({
                  providerId: activeProviderId,
                  readableGeneration: readiness?.readableItemGeneration ?? null,
                  repositoryCategoryCount: nextCategories.length,
                  sqliteProviderCategoryCount: 0,
                  wrappedCategoryCount: 0,
                  appliedProviderCategoryCount: 0,
                  totalMovieCount: null,
                  firstProviderCategoryIds: [],
                  reason: repairingWithoutSnapshot
                    ? 'repairing-sparse-generation'
                    : 'catalog-not-ready-categories-pending',
                }),
            );
            logMoviesPerf('categories_load_pending', {
              providerId: activeProviderId,
              elapsedMs: Date.now() - startedAt,
            });
            return;
          }

          // Completed generation with a genuinely empty provider rail.
          setLoadStatus('empty');
          console.info(
            '[NovaCast Movies Category Contract] ' +
              JSON.stringify({
                providerId: activeProviderId,
                readableGeneration: readiness.readableItemGeneration,
                repositoryCategoryCount: 0,
                sqliteProviderCategoryCount: 0,
                wrappedCategoryCount: 0,
                appliedProviderCategoryCount: 0,
                totalMovieCount: readiness.readableItemCount,
                firstProviderCategoryIds: [],
                reason: 'completed-empty',
              }),
          );
          return;
        }

        setCatalogRepairing(false);
        const startup = startupStateRef.current;
        startup.categoryReplacements += 1;
        setCategories((current) => mergeCategoriesPreservingCounts(current, warmedCategories));
        if (!startup.durableCategoriesReady) {
          startup.durableCategoriesReady = true;
          startup.level = 'durable-categories';
          startup.categoriesElapsedMs = Date.now() - routeMountedAtRef.current;
          startup.startupMode =
            categoriesBefore > 0 ? 'memory-cache' : ('durable-snapshot' as MoviesStartupQueryMode);
          emitMoviesStartup('movies_startup_durable_categories_ready', {
            categoryCount: warmedCategories.length,
            categoriesElapsedMs: startup.categoriesElapsedMs,
            startupMode: startup.startupMode,
          });
        }
        if (isOnnMoviesTraceEnabled()) {
          traceOnnMoviesEvent('Catalog', 'load_categories_end', {
            providerId: activeProviderId,
            categoriesBefore,
            categoriesAfter: warmedCategories.length,
            visibleMoviesBefore: moviesBefore,
            selectedCategoryId: selectedCategoryIdRef.current,
            gridMounted: isOnnMoviesGridMounted(),
            hasProviderCategories: true,
          });
        }
        console.info(
          '[NovaCast Movies Category Contract] ' +
            JSON.stringify({
              providerId: activeProviderId,
              readableGeneration: null,
              repositoryCategoryCount: nextCategories.length,
              sqliteProviderCategoryCount: nextCategories.filter((category) => category.kind === 'provider').length,
              wrappedCategoryCount: warmedCategories.length,
              appliedProviderCategoryCount: warmedCategories.filter(
                (category) => category.kind === 'provider' && category.id !== 'all',
              ).length,
              totalMovieCount: warmedCategories.find((category) => category.id === 'all')?.count ?? null,
              firstProviderCategoryIds: warmedCategories
                .filter((category) => category.kind === 'provider' && category.id !== 'all')
                .slice(0, 5)
                .map((category) => category.id),
              reason: 'provider-categories-applied',
            }),
        );
        logMoviesPerf('categories_state_applied', {
          providerId: activeProviderId,
          totalCategoryCount: warmedCategories.length,
          providerCategoryCount: warmedCategories.filter(
            (category) => category.kind === 'provider' && category.id !== 'all',
          ).length,
          hasAllMovies: warmedCategories.some((category) => category.id === 'all'),
        });
        // Stage 4.2L: defer network count warm until the route is interactive.
        if (startup.interactive) {
          scheduleSmartCountRefresh();
        } else {
          startup.pendingSmartCountRefresh = true;
        }
        setSelectedCategoryId((current) => {
          const remembered = options.initialSelectedCategoryId ?? providerMemory.selectedCategoryId;
          const decision = resolveMoviesInitialCategory({
            categories: warmedCategories,
            previousCategoryId: current,
            rememberedCategoryId: remembered,
          });
          const nextId = decision.selectedCategoryId;

          if (decision.shouldLog) {
            logMoviesInitialCategory({
              providerId: activeProviderId,
              readableGeneration: null,
              previousCategoryId: current || null,
              selectedCategoryId: nextId,
              visibleCategoryCount: decision.visibleCategoryCount,
              usedAllMoviesFallback: decision.usedAllMoviesFallback,
              reason: decision.reason,
            });
          }

          if (nextId && nextId !== current) {
            rememberMoviesScreenMemory(activeProviderId, {
              selectedCategoryId: nextId,
            });
          }

          const selected = warmedCategories.find((category) => category.id === nextId);
          const indexedSelected =
            selected?.kind === 'provider'
              ? getCategoryCountFromIndex(activeProviderId, 'movie', selected.id)
              : undefined;
          if (
            selected &&
            selected.id !== ALL_MOVIES_CATEGORY_ID &&
            selected.countKnown === false &&
            indexedSelected == null
          ) {
            // Progressive: only the first selected category may enqueue a network count.
            queueMicrotask(() => prefetchCategoryCount(selected.id, selected.kind));
          }

          return nextId;
        });
        logMoviesPerf('categories_load_ready', {
          providerId: activeProviderId,
          categoryCount: warmedCategories.length,
          elapsedMs: Date.now() - startedAt,
          countQueue: categoryCountQueueRef.current?.getStats() ?? null,
        });
      } catch (error) {
        if (!mounted) {
          return;
        }

        logMoviesPerf('categories_load_error', {
          providerId: activeProviderId,
          elapsedMs: Date.now() - startedAt,
          message: error instanceof Error ? error.message : String(error),
        });
        traceOnnMoviesCategoriesCleared('categories_load_error', {
          providerId: activeProviderId,
          categoriesBefore,
          categoriesAfter: 0,
          visibleMoviesBefore: moviesBefore,
          message: error instanceof Error ? error.message : String(error),
        });
        setCategories([]);
        setLoadStatus('error');
        setLoadErrorMessage(error instanceof Error ? error.message : 'Unable to load movie categories.');
      }
    };

    const scheduleSmartCountRefresh = () => {
      if (!startupStateRef.current.interactive) {
        startupStateRef.current.pendingSmartCountRefresh = true;
        return;
      }
      if (indexDebounceTimer) {
        clearTimeout(indexDebounceTimer);
      }

      indexDebounceTimer = setTimeout(() => {
        void refreshSmartCategoryCounts(activeProviderId, categoriesRef.current).then((refreshed) => {
          if (mounted) {
            setCategories((current) => mergeCategoriesPreservingCounts(current, refreshed));
          }
        });
      }, 500);
    };

    const reloadSmartCategoryGridIfNeeded = () => {
      if (isSmartCategoryId(selectedCategoryIdRef.current)) {
        setReloadToken((current) => current + 1);
      }
    };

    void loadCategories();

    logMoviesPerf('catalog_ready_subscription', {
      providerId: activeProviderId,
    });

    const unsubscribeMovieCategoriesUpdated = subscribeMovieCategoriesUpdated(
      activeProviderId,
      (payload) => {
        if (!mounted) {
          return;
        }
        logMoviesPerf('movie_categories_updated_received', {
          providerId: activeProviderId,
          generation: payload.generation,
          categoryCount: payload.categoryCount,
        });
        if (isOnnMoviesTraceEnabled()) {
          traceOnnMoviesEvent('Catalog', 'movie_categories_updated', {
            providerId: activeProviderId,
            eventGeneration: payload.generation,
            categoryCount: payload.categoryCount,
            categoriesBefore: categoriesRef.current.length,
            visibleMoviesBefore: visibleMoviesRef.current.length,
            selectedCategoryId: selectedCategoryIdRef.current,
            gridMounted: isOnnMoviesGridMounted(),
          });
        }
        void loadCategories();
      },
    );

    let lastPublishedGeneration = 0;
    const unsubscribeMovieReady = subscribeMovieCatalogReady(activeProviderId, (generation) => {
      if (!mounted) {
        return;
      }
      if (generation > 0 && generation <= lastPublishedGeneration) {
        console.info('[NovaCast Movies] catalog_publication_ignored_duplicate', {
          providerId: activeProviderId,
          generation,
        });
        return;
      }
      lastPublishedGeneration = Math.max(lastPublishedGeneration, generation);
      logMoviesPerf('catalog_ready_received', {
        providerId: activeProviderId,
        generation,
      });
      if (firstRunBridgeEligibleRef.current) {
        console.info('[NovaCast Movies First Run Bridge]', JSON.stringify({
          event: 'bridge-ready-publication-received',
          providerId: activeProviderId,
          generation,
          reason: 'ready-generation-wins',
        }));
        console.info('[NovaCast Movies First Run Bridge]', JSON.stringify({
          event: 'bridge-handoff-start',
          providerId: activeProviderId,
          generation,
          reason: 'ready-generation-wins',
        }));
        requestGenerationRef.current += 1;
        bridgeHandoffPendingRef.current = true;
        firstRunBridgeEligibleRef.current = false;
        setFirstRunBridgeEligible(false);
        return;
      }
      if (isOnnMoviesTraceEnabled()) {
        traceOnnMoviesEvent('Catalog', 'movie_catalog_ready', {
          providerId: activeProviderId,
          eventGeneration: generation,
          categoriesBefore: categoriesRef.current.length,
          visibleMoviesBefore: visibleMoviesRef.current.length,
          selectedCategoryId: selectedCategoryIdRef.current,
          gridMounted: isOnnMoviesGridMounted(),
        });
        traceOnnMoviesEvent('Catalog', 'atomic_generation_swap_start', {
          providerId: activeProviderId,
          eventGeneration: generation,
          categoriesBefore: categoriesRef.current.length,
          visibleMoviesBefore: visibleMoviesRef.current.length,
          selectedCategoryId: selectedCategoryIdRef.current,
        });
      }
      // Fresh generation activated — clear sparse-repair UI and atomically swap when safe.
      clearMoviesSparseRepairSchedule(activeProviderId);
      setMoviesCatalogRepairingUi(activeProviderId, false);
      setCatalogRepairing(false);
      const hadInteractiveSnapshot =
        categoriesRef.current.length > 0 && visibleMoviesRef.current.length > 0;
      // Stage 4.2L: never blank an interactive rail/grid while background refresh runs.
      if (!hadInteractiveSnapshot) {
        setLoadStatus((current) => (current === 'error' ? current : 'loading'));
      } else {
        startupStateRef.current.backgroundRefreshStarted = true;
        emitMoviesStartup('movies_startup_background_refresh_started', {
          eventGeneration: generation,
          reason: 'catalog-ready',
        });
      }

      void (async () => {
        if (!resolvedDataSource) {
          return;
        }
        const previousCategoryId = selectedCategoryIdRef.current;
        const previousFocusedMovieId = focusedMovieIdRef.current;
        const previousOffset = offsetRef.current;
        // Stage 4.2L: catalog_ready must load the new generation, not the startup pin.
        requestSqliteMovieCategoriesFullRefresh(activeProviderId);
        const nextCategories = await resolvedDataSource.getCategories();
        if (!mounted) {
          return;
        }
        const warmedCategories = warmUnresolvedCategoryCounts(nextCategories);
        const decision = resolveMoviesInitialCategory({
          categories: warmedCategories,
          previousCategoryId,
          rememberedCategoryId: options.initialSelectedCategoryId ?? providerMemory.selectedCategoryId,
        });
        // Prefer keeping the active category when the replacement still contains it.
        let selectedId =
          previousCategoryId &&
          warmedCategories.some((category) => category.id === previousCategoryId)
            ? previousCategoryId
            : decision.selectedCategoryId;
        let page =
          selectedId && !selectedId.startsWith('section:')
            ? await resolvedDataSource.getMoviesPage({
                categoryId: selectedId,
                offset: 0,
                limit: Math.max(MOVIE_PAGE_SIZE, MOVIES_STARTUP_VIEWPORT_LIMIT),
                sort: getMoviesSettingsSync().movieSortOption,
              })
            : { items: [] as MovieSummary[], totalCount: 0, hasMore: false };

        // If the kept selection somehow has no rows, re-pick first populated before paint.
        if (
          page.items.length === 0 &&
          selectedId &&
          selectedId !== ALL_MOVIES_CATEGORY_ID &&
          !selectedId.startsWith('smart:')
        ) {
          const fallback = resolveMoviesInitialCategory({
            categories: warmedCategories,
            previousCategoryId: null,
            rememberedCategoryId: null,
          });
          if (fallback.selectedCategoryId !== selectedId) {
            if (isOnnMoviesTraceEnabled()) {
              traceOnnMoviesEvent('Catalog', 'selected_category_correction', {
                providerId: activeProviderId,
                previousCategoryId: selectedId,
                nextCategoryId: fallback.selectedCategoryId,
                reason: 'atomic-swap-empty-page',
                eventGeneration: generation,
              });
            }
            selectedId = fallback.selectedCategoryId;
            page = await resolvedDataSource.getMoviesPage({
              categoryId: selectedId,
              offset: 0,
              limit: Math.max(MOVIE_PAGE_SIZE, MOVIES_STARTUP_VIEWPORT_LIMIT),
              sort: getMoviesSettingsSync().movieSortOption,
            });
          }
        }

        if (!mounted) {
          return;
        }

        const activeCategoryExists = warmedCategories.some(
          (category) => category.id === previousCategoryId,
        );
        const focusedMovieExists =
          !previousFocusedMovieId ||
          page.items.some((movie) => movie.id === previousFocusedMovieId) ||
          visibleMoviesRef.current.some((movie) => movie.id === previousFocusedMovieId);
        const deferDecision = shouldDeferMoviesBackgroundGenerationSwap({
          detailOpen: getMoviesDetailOpenForDiagnostics(),
          detailClosing: getMoviesDetailOpenForDiagnostics(),
          restoringBrowseFocus: false,
          playbackActive: false,
          userNavigating: false,
          activeCategoryExistsInReplacement: Boolean(previousCategoryId) ? activeCategoryExists : true,
          focusedMovieExistsInReplacement: focusedMovieExists,
        });

        emitMoviesStartup('movies_background_generation_ready', {
          eventGeneration: generation,
          selectedCategoryId: selectedId,
          categoryCount: warmedCategories.length,
          itemCount: page.items.length,
          previousCategoryId,
          previousFocusedMovieId,
        });

        if (
          hadInteractiveSnapshot &&
          (deferDecision.defer ||
            warmedCategories.length === 0 ||
            (page.items.length === 0 && visibleMoviesRef.current.length > 0))
        ) {
          emitMoviesStartup('movies_background_generation_swap_deferred', {
            eventGeneration: generation,
            reason:
              warmedCategories.length === 0
                ? 'empty-categories'
                : page.items.length === 0
                  ? 'empty-grid'
                  : deferDecision.reason,
            previousCategoryId,
            previousFocusedMovieId,
            previousOffset,
          });
          startupStateRef.current.backgroundRefreshFinished = true;
          emitMoviesStartup('movies_startup_background_refresh_finished', {
            eventGeneration: generation,
            deferred: true,
          });
          return;
        }

        if (
          !shouldRunMoviesStartupBackgroundWork({
            detailOpen: getMoviesDetailOpenForDiagnostics(),
            detailClosing: getMoviesDetailOpenForDiagnostics(),
          })
        ) {
          emitMoviesStartup('movies_background_generation_swap_deferred', {
            eventGeneration: generation,
            reason: 'detail-active',
            previousCategoryId,
            previousFocusedMovieId,
            previousOffset,
          });
          return;
        }

        atomicBrowseCommitRef.current = { categoryId: selectedId, generation };
        setCatalogRepairing(false);
        const categoriesBeforeSwap = categoriesRef.current.length;
        const moviesBeforeSwap = visibleMoviesRef.current.length;
        startupStateRef.current.categoryReplacements += 1;
        startupStateRef.current.movieReplacements += 1;
        // Atomic rail + page commit (Stage 4.2E) — keep these three state writes contiguous.
        setCategories((current) => mergeCategoriesPreservingCounts(current, warmedCategories));
        setSelectedCategoryId(selectedId);
        updateVisibleMovies(page.items, 'atomic-generation-swap');
        rememberMoviesScreenMemory(activeProviderId, { selectedCategoryId: selectedId });
        // Preserve prior offset identity when the focused movie remains in the page.
        const preservedFocus =
          previousFocusedMovieId &&
          page.items.some((movie) => movie.id === previousFocusedMovieId)
            ? previousFocusedMovieId
            : page.items[0]?.id ?? null;
        offsetRef.current = Math.max(page.items.length, previousOffset);
        setHasMore(page.hasMore);
        setFocusedMovieId(preservedFocus);
        setLoadStatus(page.items.length > 0 ? 'ready' : hadInteractiveSnapshot ? 'ready' : 'empty');
        setLoading(false);
        setCategoryLoading(false);
        setFirstPageLoadGate({
          loadingCategoryId: selectedId,
          loadingRequestToken: `atomic:${generation}:${selectedId}`,
          firstPageResolvedCategoryId: selectedId,
        });
        emitMoviesStartup('movies_background_generation_swap_committed', {
          eventGeneration: generation,
          reason: deferDecision.reason,
          previousCategoryId,
          selectedCategoryId: selectedId,
          previousFocusedMovieId,
          preservedFocus,
          previousOffset,
          categoriesBefore: categoriesBeforeSwap,
          categoriesAfter: warmedCategories.length,
          visibleMoviesBefore: moviesBeforeSwap,
          visibleMoviesAfter: page.items.length,
        });
        startupStateRef.current.backgroundRefreshFinished = true;
        emitMoviesStartup('movies_startup_background_refresh_finished', {
          eventGeneration: generation,
          deferred: false,
        });
        if (isOnnMoviesTraceEnabled()) {
          traceOnnMoviesEvent('Catalog', 'atomic_generation_swap_end', {
            providerId: activeProviderId,
            eventGeneration: generation,
            previousCategoryId,
            selectedCategoryId: selectedId,
            categoriesBefore: categoriesBeforeSwap,
            categoriesAfter: warmedCategories.length,
            visibleMoviesBefore: moviesBeforeSwap,
            visibleMoviesAfter: page.items.length,
            gridMounted: isOnnMoviesGridMounted(),
          });
        }
        logMoviesPerf('atomic_generation_swap_committed', {
          providerId: activeProviderId,
          generation,
          selectedCategoryId: selectedId,
          categoryCount: warmedCategories.length,
          itemCount: page.items.length,
          previousCategoryId,
          marker: 'stage4e-atomic-generation-pinning-v1',
        });
        if (decision.shouldLog || previousCategoryId !== selectedId) {
          logMoviesInitialCategory({
            providerId: activeProviderId,
            readableGeneration: generation,
            previousCategoryId: previousCategoryId || null,
            selectedCategoryId: selectedId,
            visibleCategoryCount: decision.visibleCategoryCount,
            usedAllMoviesFallback: decision.usedAllMoviesFallback,
            reason: decision.reason,
          });
        }
        reloadSmartCategoryGridIfNeeded();
      })();
    });

    const unsubscribeCounts = subscribeCategoryCountIndex(() => {
      if (!mounted) {
        return;
      }
      scheduleSmartCountRefresh();
    });

    const unsubscribeSmartCache = subscribeSmartCategoryCache(() => {
      if (!mounted) {
        return;
      }
      scheduleSmartCountRefresh();
      reloadSmartCategoryGridIfNeeded();
    });

    const unsubscribeSync = subscribeCatalogSyncPhase(activeProviderId, (phase) => {
      if (!mounted) {
        return;
      }
      if (isOnnMoviesTraceEnabled()) {
        traceOnnMoviesEvent('Catalog', 'catalog_sync_phase', {
          providerId: activeProviderId,
          phase,
          categoriesBefore: categoriesRef.current.length,
          visibleMoviesBefore: visibleMoviesRef.current.length,
          selectedCategoryId: selectedCategoryIdRef.current,
          gridMounted: isOnnMoviesGridMounted(),
        });
      }
      if (phase === 'syncing') {
        return;
      }
      if (phase === 'ready' || phase === 'smart-building') {
        scheduleSmartCountRefresh();
      }
    });

    const unsubscribeLibrary = subscribeMovieLibrary(() => {
      if (!mounted) {
        return;
      }
      scheduleSmartCountRefresh();
    });

    const unsubscribeSettings = subscribeMoviesSettings(() => {
      if (!mounted) {
        return;
      }

      const nextHideSmartCategories = getMoviesSettingsSync().hideSmartCategories;
      if (nextHideSmartCategories === hideSmartCategoriesRef.current) {
        return;
      }

      hideSmartCategoriesRef.current = nextHideSmartCategories;
      void loadCategories();
    });

    return () => {
      mounted = false;
      if (indexDebounceTimer) {
        clearTimeout(indexDebounceTimer);
      }
      unsubscribeCounts();
      unsubscribeSmartCache();
      unsubscribeSync();
      unsubscribeMovieReady();
      unsubscribeMovieCategoriesUpdated();
      unsubscribeLibrary();
      unsubscribeSettings();
    };
  }, [
    activeProviderId,
    emitMoviesStartup,
    options.initialSelectedCategoryId,
    providerMemory.selectedCategoryId,
    resolvedDataSource,
    warmUnresolvedCategoryCounts,
  ]);

  useEffect(() => {
    focusedMovieIdRef.current = focusedMovieId;
  }, [focusedMovieId]);

  const selectedMovieIdRef = useRef<string | null>(selectedMovieId);
  useEffect(() => {
    selectedMovieIdRef.current = selectedMovieId;
  }, [selectedMovieId]);

  useEffect(() => {
    if (!resolvedDataSource || (!isSearchMode && (!selectedCategoryId || selectedCategoryId.startsWith('section:')))) {
      return;
    }

    // Stage 4.2E: atomic generation swap already committed categories + first page together.
    if (
      atomicBrowseCommitRef.current &&
      atomicBrowseCommitRef.current.categoryId === selectedCategoryId
    ) {
      atomicBrowseCommitRef.current = null;
      return;
    }

    // Let the category rail paint before competing with poster/page fetches.
    if (!isSearchMode && categories.length === 0) {
      logMoviesPerf('movies_page_gated_waiting_categories', {
        providerId: activeProviderId,
        categoryId: selectedCategoryId,
      });
      return;
    }

    let cancelled = false;
    const generation = ++requestGenerationRef.current;
    const requestKey = buildContentSortRequestKey({
      providerId: activeProviderId,
      contentType: 'movie',
      categoryId: selectedCategoryId,
      sort: sortOption,
      offset: 0,
      generation,
    });
    const previousFocusedMovieId = focusedMovieIdRef.current;
    const retainVisible =
      !isSearchMode &&
      previousListScopeRef.current.providerId === activeProviderId &&
      previousListScopeRef.current.categoryId === selectedCategoryId;
    previousListScopeRef.current = { providerId: activeProviderId, categoryId: selectedCategoryId };

    // Stage 3E.2/3E.3: arm the primary-loader gate synchronously so it cannot flash
    // off between category selection and the async first-page start.
    // Gate never mutates displayed movies / selected category — observe readiness only.
    setFirstPageLoadGate({
      loadingCategoryId: selectedCategoryId,
      loadingRequestToken: requestKey,
      firstPageResolvedCategoryId: null,
    });

    const loadInitialPage = async () => {
      const pageStartedAt = Date.now();
      await Promise.resolve();

      setLoading(true);
      setCategoryLoading(true);
      setLoadStatus(retainVisible ? loadStatusRef.current : 'loading');
      setLoadErrorMessage(null);
      // Stage 3E: keep prior posters as a dimmed backdrop during uncached
      // category first-page load. Replace on success; clear only on error.
      setCategoryHasRatings(true);
      offsetRef.current = 0;
      let keepPendingForCatalogReady = false;

      logMoviesAction('page-requested', {
        categoryId: selectedCategoryId,
        offset: 0,
        limit: MOVIE_PAGE_SIZE,
      });
      logMoviesPerf('movies_page_start', {
        providerId: activeProviderId,
        categoryId: selectedCategoryId,
        search: isSearchMode,
      });
      if (isOnnMoviesTraceEnabled()) {
        traceOnnMoviesEvent('Catalog', 'page_load_start', {
          providerId: activeProviderId,
          categoryId: selectedCategoryId,
          search: isSearchMode,
          categoriesCount: categoriesRef.current.length,
          visibleMoviesBefore: visibleMoviesRef.current.length,
          gridMounted: isOnnMoviesGridMounted(),
        });
      }

      try {
        logMoviesPageCommit({
          phase: 'query-start',
          categoryId: selectedCategoryId,
          requestToken: requestKey,
          currentRequestTokenMatches: true,
          componentInstance: presentationInstanceRef.current,
          rowCount: 0,
          selectedCategoryMatches: true,
          mounted: !cancelled,
          cancelled,
          visibleCountBefore: visibleMoviesRef.current.length,
          visibleCountAfter: visibleMoviesRef.current.length,
        });
        const page =
          isSearchMode
            ? await resolvedDataSource.searchMovies({
                query: queryMode,
                offset: 0,
                limit: MOVIE_PAGE_SIZE,
              })
            : await resolvedDataSource.getMoviesPage({
                categoryId: selectedCategoryId,
                offset: 0,
                limit: MOVIE_PAGE_SIZE,
                sort: sortOption,
                queryPurpose: startupStateRef.current.interactive
                  ? 'runtime'
                  : 'startup-viewport',
                pinnedGeneration:
                  getMoviesStartupSession(activeProviderId)?.pinnedGeneration || undefined,
                startupSessionId:
                  getMoviesStartupSession(activeProviderId)?.sessionId ?? null,
              });

        const tokenMatches =
          !cancelled &&
          buildContentSortRequestKey({
            providerId: activeProviderId,
            contentType: 'movie',
            categoryId: selectedCategoryId,
            sort: sortOption,
            offset: 0,
            generation,
          }) === requestKey;
        logMoviesPageCommit({
          phase: 'query-resolved',
          categoryId: selectedCategoryId,
          requestToken: requestKey,
          currentRequestTokenMatches: tokenMatches,
          componentInstance: presentationInstanceRef.current,
          rowCount: page.items.length,
          selectedCategoryMatches: tokenMatches,
          mounted: !cancelled,
          cancelled,
          visibleCountBefore: visibleMoviesRef.current.length,
          visibleCountAfter: visibleMoviesRef.current.length,
          rejectReason: tokenMatches ? null : cancelled ? 'cancelled-or-unmounted' : 'request-token-mismatch',
        });

        if (!tokenMatches) {
          logMoviesPageCommit({
            phase: 'commit-rejected',
            categoryId: selectedCategoryId,
            requestToken: requestKey,
            currentRequestTokenMatches: false,
            componentInstance: presentationInstanceRef.current,
            rowCount: page.items.length,
            selectedCategoryMatches: false,
            mounted: !cancelled,
            cancelled,
            visibleCountBefore: visibleMoviesRef.current.length,
            visibleCountAfter: visibleMoviesRef.current.length,
            rejectReason: cancelled ? 'cancelled-or-unmounted' : 'request-token-mismatch',
          });
          return;
        }

        const startupSession = getMoviesStartupSession(activeProviderId);
        const detailActive = getMoviesDetailOpenForDiagnostics();
        const dropLateStartup = shouldDropLateMoviesStartupFocusResult({
          startupInteractive: startupStateRef.current.interactive,
          startupFocusReleased: Boolean(startupSession?.focusReleased),
          detailOpen: detailActive,
          detailClosing: detailActive,
        });

        // After startup focus is released / session interactive, Detail-active
        // completions must not mutate browse focus or preferred targets.
        // An empty remounted presentation must still hydrate from this page.
        if (dropLateStartup && detailActive && visibleMoviesRef.current.length > 0) {
          emitMoviesStartup('movies_startup_late_focus_result_dropped', {
            categoryId: selectedCategoryId,
            returnedCount: page.items.length,
            reason: startupSession?.focusReleased
              ? 'startup-focus-released'
              : 'detail-active',
            marker: MOVIES_FOCUS_STAGE4L1_MARKER,
          });
          return;
        }

        const visibleCountBefore = visibleMoviesRef.current.length;
        const commitDecision = resolveMoviesPageCommitDecision({
          browseUiFrozenForDetail: isMoviesBrowseUiFrozenForDetail(),
          detailOpenForDiagnostics: getMoviesDetailOpenForDiagnostics(),
          currentRequestTokenMatches: true,
          selectedCategoryMatches: true,
          mounted: !cancelled,
          cancelled,
          rowCount: page.items.length,
          visibleCountBefore,
          reason: retainVisible ? 'category-first-page-replace' : 'category-first-page-load',
        });
        logMoviesPageCommit({
          phase: 'commit-attempt',
          categoryId: selectedCategoryId,
          requestToken: requestKey,
          currentRequestTokenMatches: true,
          componentInstance: presentationInstanceRef.current,
          rowCount: page.items.length,
          selectedCategoryMatches: true,
          mounted: !cancelled,
          cancelled,
          visibleCountBefore,
          visibleCountAfter: visibleCountBefore,
          rejectReason: commitDecision.rejectReason,
        });

        offsetRef.current = page.items.length;
        startupStateRef.current.movieReplacements += 1;
        updateVisibleMovies(
          page.items,
          retainVisible ? 'category-first-page-replace' : 'category-first-page-load',
          (visibleCountAfter) => {
            setFirstPageLoadGate((previous) => {
              if (previous.loadingRequestToken !== requestKey) {
                return previous;
              }
              return {
                loadingCategoryId: selectedCategoryId,
                loadingRequestToken: requestKey,
                firstPageResolvedCategoryId: selectedCategoryId,
              };
            });
            logMoviesPageCommit({
              phase: 'commit-accepted',
              categoryId: selectedCategoryId,
              requestToken: requestKey,
              currentRequestTokenMatches: true,
              componentInstance: presentationInstanceRef.current,
              rowCount: page.items.length,
              selectedCategoryMatches: true,
              mounted: !cancelled,
              cancelled,
              visibleCountBefore,
              visibleCountAfter,
            });
            if (visibleCountAfter > 0) {
              logMoviesRecovery({
                phase: 'localPresentationHydrated',
                componentInstance: presentationInstanceRef.current,
                sessionAlreadyInteractive: shouldBlockMoviesStartupReentry(activeProviderId),
                localPresentationHydrated: true,
                readyGenerationPresent: true,
              });
            }
          },
        );
        if (!commitDecision.apply) {
          logMoviesPageCommit({
            phase: 'commit-rejected',
            categoryId: selectedCategoryId,
            requestToken: requestKey,
            currentRequestTokenMatches: true,
            componentInstance: presentationInstanceRef.current,
            rowCount: page.items.length,
            selectedCategoryMatches: true,
            mounted: !cancelled,
            cancelled,
            visibleCountBefore,
            visibleCountAfter: visibleCountBefore,
            rejectReason: commitDecision.rejectReason,
          });
        }
        setHasMore(page.hasMore);
        if ('hasValidRatings' in page) {
          setCategoryHasRatings(Boolean(page.hasValidRatings));
        }
        syncCategoryCount(selectedCategoryId, page.totalCount);
        if (firstRunBridgeEligibleRef.current) {
          console.info('[NovaCast Movies First Run Bridge]', JSON.stringify({
            event: 'bridge-category-count-resolved',
            providerId: activeProviderId,
            selectedCategoryId,
            totalCount: page.totalCount,
            returnedCount: page.items.length,
            requestToken: requestKey,
            reason: 'bridge-page-total-count',
          }));
        }
        logMoviesPerf('movies_page_ready', {
          providerId: activeProviderId,
          categoryId: selectedCategoryId,
          itemCount: page.items.length,
          totalCount: page.totalCount,
          elapsedMs: Date.now() - pageStartedAt,
          countQueue: categoryCountQueueRef.current?.getStats() ?? null,
        });
        if (isOnnMoviesTraceEnabled()) {
          traceOnnMoviesEvent('Catalog', 'page_load_end', {
            providerId: activeProviderId,
            categoryId: selectedCategoryId,
            itemCount: page.items.length,
            totalCount: page.totalCount,
            elapsedMs: Date.now() - pageStartedAt,
            gridMounted: isOnnMoviesGridMounted(),
          });
        }

        if (!startupStateRef.current.interactive) {
          const startupFocus = resolveMoviesStartupFocusTarget({
            savedMovieId: previousFocusedMovieId,
            // Stage 4.2N: read via ref, not the reactive `selectedMovieId` value,
            // so that MovieDetailPopupV2 selecting a movie (Play target) does not
            // add `selectedMovieId` to this effect's dependency array and
            // retrigger a full category-page reload while the popup is open.
            selectedMovieId: selectedMovieIdRef.current,
            viewportMovieIds: page.items.map((movie) => movie.id),
            hasCategories: categoriesRef.current.length > 0,
          });
          if (!startupStateRef.current.firstViewportReady && page.items.length > 0) {
            startupStateRef.current.firstViewportReady = true;
            startupStateRef.current.level = 'first-viewport';
            startupStateRef.current.firstViewportElapsedMs =
              Date.now() - routeMountedAtRef.current;
            emitMoviesStartup('movies_startup_first_viewport_ready', {
              categoryId: selectedCategoryId,
              returnedCount: page.items.length,
              firstViewportElapsedMs: startupStateRef.current.firstViewportElapsedMs,
              savedMovieId: previousFocusedMovieId,
              savedMovieFound: startupFocus.reason === 'saved-focused',
            });
            emitMoviesStartup('movies_startup_focus_target_selected', {
              movieId: startupFocus.movieId,
              reason: startupFocus.reason,
              fallbackUsed: startupFocus.fallbackUsed,
            });
            if (startupFocus.fallbackUsed) {
              emitMoviesStartup('movies_startup_focus_fallback_used', {
                movieId: startupFocus.movieId,
                reason: startupFocus.reason,
                savedMovieId: previousFocusedMovieId,
              });
            }
          }
          setFocusedMovieId(startupFocus.movieId);
          if (page.items.length > 0) {
            markStartupInteractiveIfReady();
            if (
              startupStateRef.current.interactive &&
              startupStateRef.current.pendingSmartCountRefresh
            ) {
              startupStateRef.current.pendingSmartCountRefresh = false;
              void refreshSmartCategoryCounts(activeProviderId, categoriesRef.current).then(
                (refreshed) => {
                  if (!cancelled) {
                    setCategories((current) =>
                      mergeCategoriesPreservingCounts(current, refreshed),
                    );
                  }
                },
              );
            }
          }
        } else {
          // Runtime category/page loads: bounded focus restore, not startup-owned.
          const restoredFocusId =
            page.items.find((movie) => movie.id === previousFocusedMovieId)?.id ??
            page.items[0]?.id ??
            null;
          setFocusedMovieId(restoredFocusId);
        }

        setSelectedMovieId((current) => {
          if (current && page.items.some((movie) => movie.id === current)) {
            return current;
          }

          // Stage 3G.4: keep Search/detail selections that are outside the current
          // browse page so hiding Search / page refresh cannot clear Play's movie.
          if (current && pinnedSelectedMovieIdRef.current === current) {
            return current;
          }

          // Focus restoration is browse chrome. Selection is created only by
          // explicit poster activation.
          return null;
        });
        // Genuine completed-generation zero-result categories may show empty.
        // Catalog-not-ready must never reach here (gated / typed error below).
        setLoadStatus(page.items.length > 0 ? 'ready' : 'empty');

        logMoviesAction('page-loaded', {
          categoryId: selectedCategoryId,
          offset: 0,
          limit: MOVIE_PAGE_SIZE,
          returnedCount: page.items.length,
          totalCount: page.totalCount,
        });
      } catch (error) {
        if (cancelled || buildContentSortRequestKey({
          providerId: activeProviderId,
          contentType: 'movie',
          categoryId: selectedCategoryId,
          sort: sortOption,
          offset: 0,
          generation,
        }) !== requestKey) {
          return;
        }

        // Stage 4.2A: generation-0 / incomplete catalog is pending, not empty/error.
        if (isMoviesCatalogNotReadyError(error)) {
          keepPendingForCatalogReady = true;
          logMoviesPerf('movies_page_catalog_not_ready', {
            providerId: activeProviderId,
            categoryId: selectedCategoryId,
          });
          setLoadStatus('loading');
          setLoadErrorMessage(null);
          // Keep the primary-loader gate armed; do not resolve first-page readiness.
          return;
        }

        updateVisibleMovies([], 'category-first-page-error');
        setHasMore(false);
        setLoadStatus('error');
        setLoadErrorMessage(error instanceof Error ? error.message : 'Unable to load movies for this category.');
        setFirstPageLoadGate((previous) => {
          if (previous.loadingRequestToken !== requestKey) {
            return previous;
          }
          return {
            loadingCategoryId: selectedCategoryId,
            loadingRequestToken: requestKey,
            firstPageResolvedCategoryId: selectedCategoryId,
          };
        });
      } finally {
        if (
          !keepPendingForCatalogReady &&
          !cancelled &&
          buildContentSortRequestKey({
            providerId: activeProviderId,
            contentType: 'movie',
            categoryId: selectedCategoryId,
            sort: sortOption,
            offset: 0,
            generation,
          }) === requestKey
        ) {
          setLoading(false);
          setCategoryLoading(false);
        }
      }
    };

    void loadInitialPage();

    return () => {
      cancelled = true;
    };
  }, [
    activeProviderId,
    categories.length,
    emitMoviesStartup,
    isSearchMode,
    markStartupInteractiveIfReady,
    queryMode,
    reloadToken,
    resolvedDataSource,
    selectedCategoryId,
    // Stage 4.2N: intentionally excluded — see selectedMovieIdRef usage above.
    // selectedMovieId changes when MovieDetailPopupV2 selects a movie (Play
    // target) and must not retrigger a category-page reload while browsing.
    sortOption,
    syncCategoryCount,
    updateVisibleMovies,
  ]);

  const focusedMovie = useMemo(
    () => visibleMovies.find((movie) => movie.id === focusedMovieId) ?? visibleMovies[0] ?? null,
    [focusedMovieId, visibleMovies],
  );
  const selectedMovie = useMemo(() => {
    const fromGrid = resolveSelectedMovie(selectedMovieId, visibleMovies);
    if (fromGrid) {
      return fromGrid;
    }

    if (selectedMovieSnapshot?.id === selectedMovieId) {
      return selectedMovieSnapshot;
    }

    return null;
  }, [selectedMovieId, selectedMovieSnapshot, visibleMovies]);

  const loadMovieDetail = useCallback(
    async (
      movie: MovieSummary,
      loadOptions?: { origin?: MovieDetailEnrichmentOrigin },
    ) => {
      const requestId = ++detailRequestIdRef.current;
      const origin = loadOptions?.origin ?? 'browse';
      detailOriginRef.current = origin;
      const fallback = buildMoviePreviewDetail(movie);
      console.info('[NovaCast Movies Detail Load]', {
        phase: 'start',
        providerId: activeProviderId,
        movieId: movie.id,
        summaryHasProviderId: Boolean((movie as MovieSummary & { providerId?: string }).providerId),
        summaryHasContentId: Boolean(movie.id),
        summaryHasContainerExtension: Boolean(movie.containerExtension),
        requestAction: resolvedDataSource?.getMovieInfo ? 'getMovieInfo' : 'preview-only',
        origin,
      });
      // Local-first: open Detail immediately from the selected summary / SQLite row.
      setMovieDetail(fallback);
      setDetailError(null);
      setDetailLoading(true);

      try {
        const detail = await resolvedDataSource?.getMovieInfo?.(movie.id);
        if (requestId !== detailRequestIdRef.current) {
          console.info('[NovaCast Movies Detail Load]', {
            phase: 'failure',
            providerId: activeProviderId,
            movieId: movie.id,
            summaryHasProviderId: Boolean((movie as MovieSummary & { providerId?: string }).providerId),
            summaryHasContentId: Boolean(movie.id),
            summaryHasContainerExtension: Boolean(movie.containerExtension),
            requestAction: resolvedDataSource?.getMovieInfo ? 'getMovieInfo' : 'preview-only',
            errorName: 'StaleRequest',
            errorCode: 'stale-detail-request',
            status: 'cancelled',
            origin,
          });
          return;
        }

        setMovieDetail(detail ?? fallback);
        console.info('[NovaCast Movies Detail Load]', {
          phase: detail ? 'success' : 'failure',
          providerId: activeProviderId,
          movieId: movie.id,
          summaryHasProviderId: Boolean((movie as MovieSummary & { providerId?: string }).providerId),
          summaryHasContentId: Boolean(movie.id),
          summaryHasContainerExtension: Boolean(movie.containerExtension),
          requestAction: resolvedDataSource?.getMovieInfo ? 'getMovieInfo' : 'preview-only',
          errorName: detail ? null : 'DetailUnavailable',
          errorCode: detail ? null : 'detail-null-response',
          status: detail ? 'fulfilled' : 'empty',
          origin,
        });
        if (!detail && resolvedDataSource?.getMovieInfo) {
          setDetailError('Detailed movie information is unavailable.');
        }

        // Clear loading so Play stays available while optional provider enrichment merges.
        if (requestId === detailRequestIdRef.current) {
          setDetailLoading(false);
        }

        if (!detail || !resolvedDataSource?.enrichMovieInfo) {
          return;
        }

        // Progressive enrichment: merge into the same Detail overlay (no remount).
        void resolvedDataSource
          .enrichMovieInfo(movie.id)
          .then((enriched) => {
            if (requestId !== detailRequestIdRef.current || !enriched) {
              return;
            }
            if (enriched.id !== movie.id) {
              return;
            }
            setMovieDetail(enriched);
            setSelectedMovieSnapshot((previous) => {
              if (!previous || previous.id !== movie.id) {
                return previous;
              }
              const nextExtension = enriched.containerExtension;
              if (!nextExtension || previous.containerExtension === nextExtension) {
                return previous;
              }
              return { ...previous, containerExtension: nextExtension };
            });
          })
          .catch((error) => {
            console.info(
              '[NovaCast Movies Detail Load]',
              {
                phase: 'enrichment-nonfatal',
                providerId: activeProviderId,
                movieId: movie.id,
                origin,
                errorName: error instanceof Error ? error.name : 'UnknownError',
                errorCode: error instanceof Error ? error.message : String(error),
              },
            );
          });
      } catch (error) {
        console.info('[NovaCast Movies Detail Load]', {
          phase: 'failure',
          providerId: activeProviderId,
          movieId: movie.id,
          summaryHasProviderId: Boolean((movie as MovieSummary & { providerId?: string }).providerId),
          summaryHasContentId: Boolean(movie.id),
          summaryHasContainerExtension: Boolean(movie.containerExtension),
          requestAction: resolvedDataSource?.getMovieInfo ? 'getMovieInfo' : 'preview-only',
          errorName: error instanceof Error ? error.name : 'UnknownError',
          errorCode: error instanceof Error ? error.message : String(error),
          status: 'rejected',
          origin,
        });
        if (requestId === detailRequestIdRef.current) {
          // Retain local preview; Play remains available when a source can be resolved.
          setMovieDetail(fallback);
          setDetailError(null);
        }
      } finally {
        if (requestId === detailRequestIdRef.current) {
          setDetailLoading(false);
        }
      }
    },
    [activeProviderId, resolvedDataSource],
  );

  const selectCategory = (categoryId: string) => {
    if (categoryId === selectedCategoryId && !isSearchMode) {
      return;
    }

    logMoviesAction('category-selected', { categoryId });
    setSearchQueryState('');
    pinnedSelectedMovieIdRef.current = null;
    setSelectedMovieSnapshot(null);
    setSelectedMovieId(null);
    setSelectedCategoryId(categoryId);
    setLoadStatus('loading');
    setLoadErrorMessage(null);
    const selected = categoriesRef.current.find((category) => category.id === categoryId);
    if (selected?.countKnown === false) {
      prefetchCategoryCount(categoryId, selected.kind);
    }
    rememberMoviesScreenMemory(activeProviderId, {
      selectedCategoryId: categoryId,
    });
  };

  const focusMovie = useCallback(
    (movie: MovieSummary) => {
      // Keep D-pad focus out of React state â€” matching Series. Local poster chrome
      // handles highlight; writing focusedMovieId here re-renders the whole grid.
      focusedMovieIdRef.current = movie.id;
      rememberMoviesScreenMemory(activeProviderId, {
        focusedMovieId: movie.id,
      });
    },
    [activeProviderId],
  );

  const selectMovie = (movie: MovieSummary) => {
    logMoviesAction('movie-selected', { movieId: movie.id });
    focusedMovieIdRef.current = movie.id;
    pinnedSelectedMovieIdRef.current = movie.id;
    setFocusedMovieId(movie.id);
    setSelectedMovieId(movie.id);
    setSelectedMovieSnapshot(movie);
    setMovieDetail(buildMoviePreviewDetail(movie));
    rememberMoviesScreenMemory(activeProviderId, {
      focusedMovieId: movie.id,
      selectedMovieId: movie.id,
    });
  };

  const loadMore = async () => {
    if (!resolvedDataSource || loading || !hasMore) {
      return;
    }

    const generationAtRequest = requestGenerationRef.current;
    const sortAtRequest = sortOption;
    const categoryAtRequest = selectedCategoryId;
    const providerAtRequest = activeProviderId;
    const nextOffset = offsetRef.current;
    setLoading(true);

    logMoviesAction('page-requested', {
      categoryId: selectedCategoryId,
      offset: nextOffset,
      limit: MOVIE_PAGE_SIZE,
    });

    try {
      const page =
        isSearchMode
          ? await resolvedDataSource.searchMovies({
              query: queryMode,
              offset: nextOffset,
              limit: MOVIE_PAGE_SIZE,
            })
          : await resolvedDataSource.getMoviesPage({
              categoryId: selectedCategoryId,
              offset: nextOffset,
              limit: MOVIE_PAGE_SIZE,
              sort: sortOption,
            });

      if (
        generationAtRequest !== requestGenerationRef.current ||
        sortAtRequest !== sortOption ||
        categoryAtRequest !== selectedCategoryId ||
        providerAtRequest !== activeProviderId
      ) {
        return;
      }

      // Stage 4.2J: keep offset/list mutation atomic with the deferred UI commit.
      enqueueOrApplyBrowseCommit('pagination', () => {
        offsetRef.current += page.items.length;
        setVisibleMovies((current) => {
          const next = uniqueMovies(current, page.items);
          visibleMoviesRef.current = next;
          console.info(
            '[NovaCast Movies Data] ' +
              JSON.stringify({
                reason: 'pagination-append',
                arrayIdentityChanged: current !== next,
                previousLength: current.length,
                nextLength: next.length,
              }),
          );
          return next;
        });
        setHasMore(page.hasMore);
        if ('hasValidRatings' in page) {
          setCategoryHasRatings((current) => current || Boolean(page.hasValidRatings));
        }
        syncCategoryCount(selectedCategoryId, page.totalCount);
        if (firstRunBridgeEligibleRef.current) {
          console.info('[NovaCast Movies First Run Bridge]', JSON.stringify({
            event: 'bridge-category-count-resolved',
            providerId: activeProviderId,
            selectedCategoryId,
            totalCount: page.totalCount,
            returnedCount: page.items.length,
            requestToken: `${generationAtRequest}:${selectedCategoryId}:${nextOffset}`,
            reason: 'bridge-page-total-count',
          }));
        }
        setLoadStatus((current) => (current === 'error' ? current : 'ready'));
        if (!focusedMovieIdRef.current && page.items[0]) {
          setFocusedMovieId(page.items[0].id);
        }
        logMoviesAction('page-loaded', {
          categoryId: selectedCategoryId,
          offset: nextOffset,
          limit: MOVIE_PAGE_SIZE,
          returnedCount: page.items.length,
          totalCount: page.totalCount,
        });
      });
    } catch (error) {
      if (
        generationAtRequest !== requestGenerationRef.current ||
        sortAtRequest !== sortOption ||
        categoryAtRequest !== selectedCategoryId ||
        providerAtRequest !== activeProviderId
      ) {
        return;
      }

      setLoadStatus('error');
      setLoadErrorMessage(error instanceof Error ? error.message : 'Unable to load more movies.');
    } finally {
      if (
        generationAtRequest === requestGenerationRef.current &&
        sortAtRequest === sortOption &&
        categoryAtRequest === selectedCategoryId &&
        providerAtRequest === activeProviderId
      ) {
        setLoading(false);
      }
    }
  };

  const setSort = (next: ContentSortOption) => {
    void setMovieSortOption(next);
  };

  const setSearchQuery = (nextQuery: string) => {
    setSearchQueryState(nextQuery);
  };

  const visibleMovieCategories = useMemo(
    () => getVisibleMovieCategories(resolvedDataSource ? categories : []),
    [categories, resolvedDataSource],
  );

  return {
    categories: resolvedDataSource ? categories : [],
    visibleMovieCategories,
    selectedCategoryId,
    focusedMovie: resolvedDataSource ? focusedMovie : null,
    selectedMovie: resolvedDataSource ? selectedMovie : null,
    selectedMovieId: resolvedDataSource ? selectedMovieId : null,
    visibleMovies: resolvedDataSource ? visibleMovies : [],
    loading: resolvedDataSource ? loading : false,
    categoryLoading: resolvedDataSource ? categoryLoading : false,
    loadStatus: resolvedDataSource ? loadStatus : 'error',
    catalogRepairing: resolvedDataSource ? catalogRepairing : false,
    loadErrorMessage: resolvedDataSource ? loadErrorMessage : 'Provider is not connected.',
    hasMore: resolvedDataSource ? hasMore : false,
    selectCategory,
    prefetchCategoryCount,
    focusMovie,
    selectMovie,
    loadMovieDetail,
    movieDetail: resolvedDataSource ? movieDetail : null,
    detailLoading: resolvedDataSource ? detailLoading : false,
    detailError: resolvedDataSource ? detailError : null,
    resolvePlaybackMovieId: () => resolvePlaybackMovieId(selectedMovieId, focusedMovieIdRef.current),
    getFocusedMovieId: () => focusedMovieIdRef.current,
    /** Diagnostics-only: next page offset (does not change load behavior). */
    getListOffset: () => offsetRef.current,
    firstPageLoadGate,
    loadMore,
    flushDeferredBrowseCommits,
    reload,
    searchQuery,
    setSearchQuery,
    sortOption,
    setSort,
    categoryHasRatings,
    hasDataSource: Boolean(resolvedDataSource),
    /** Stage 4.2L: true once durable categories + first viewport are ready. */
    startupInteractive,
    getStartupDiagnostics: () => ({ ...startupStateRef.current }),
  };
}
