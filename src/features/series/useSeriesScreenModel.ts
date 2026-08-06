import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useProviderStore } from '@/features/providers/providerStore';
import { useActiveProviderBundle } from '@/features/providers/useActiveProviderBundle';
import type { MediaCategory, SeriesDetail, SeriesSummary } from '@/features/media-browser/mediaTypes';
import { useMediaLibraryStore, subscribeMediaLibrary } from '@/features/media-browser/mediaLibraryStore';
import { setSeriesSortOption, subscribeMediaSettings, useMediaSettingsStore } from '@/features/media-browser/mediaSettingsStore';
import type { ContentSortOption } from '@/features/media-browser/contentSorting';
import { buildContentSortRequestKey } from '@/features/media-browser/contentSortRequest';
import {
  refreshSmartSeriesCategoryCounts,
} from '@/features/series/smart/SmartSeriesDataSource';
import { subscribeCategoryCountIndex } from '@/features/providers/categoryCountIndexStore';
import { subscribeCatalogSyncPhase } from '@/features/providers/providerCatalogSync';
import { subscribeSmartCategoryCache } from '@/features/providers/smartCategoryCacheStore';
import { findDefaultBrowseCategoryId, isSmartCategoryId } from '@/features/media-browser/mediaCategoryUtils';
import type { SeriesDataSource } from './data/SeriesDataSource';
import { getSeriesScreenMemory, rememberSeriesScreenMemory } from './seriesScreenMemory';
import { matchSeriesMetadata } from './metadata/seriesMetadataMatcher';
import { emitSeriesStartup, logSeriesPerf } from './seriesDiagnostics';
import {
  evaluateSeriesStartupBudgets,
  mergeSeriesCategoriesPreservingCounts,
  resolveSeriesStartupFocusTarget,
  SERIES_FOCUS_STAGE4O_MARKER,
  SERIES_STARTUP_VIEWPORT_LIMIT,
  type SeriesStartupQueryMode,
  type SeriesStartupReadinessLevel,
} from './seriesStartupFastPath';
import {
  getMemorySeriesStartupSnapshot,
  loadSeriesStartupDurableSnapshot,
  saveSeriesStartupDurableSnapshot,
} from './seriesStartupSnapshotStore';
import {
  beginSeriesStartupSession,
  getSeriesStartupSession,
  markSeriesStartupSessionInteractive,
  SERIES_FOCUS_STAGE4O1_MARKER,
  shouldBlockSeriesStartupReentry,
  shouldDropLateSeriesStartupFocusResult,
} from './seriesStartupRuntimeIsolation';

export type UseSeriesScreenModelOptions = {
  dataSource?: SeriesDataSource;
  initialSelectedCategoryId?: string;
  initialFocusedSeriesId?: string | null;
  initialSelectedSeriesId?: string | null;
};

export type SeriesLoadStatus = 'loading' | 'ready' | 'empty' | 'error';

function uniqueSeries(existing: SeriesSummary[], incoming: SeriesSummary[]) {
  const seen = new Set(existing.map((series) => series.id));
  return [...existing, ...incoming.filter((series) => !seen.has(series.id))];
}

let seriesCategoriesGenerationSeq = 0;

export function useSeriesScreenModel(options: UseSeriesScreenModelOptions = {}) {
  const { selectedProvider } = useProviderStore();
  const { bundle } = useActiveProviderBundle();
  const activeProviderId = selectedProvider?.id ?? 'demo-provider';
  const settings = useMediaSettingsStore();
  const sortOption = settings.seriesSortOption;
  const providerMemory = getSeriesScreenMemory(activeProviderId);

  const resolvedDataSource = useMemo(() => {
    if (options.dataSource) {
      return options.dataSource;
    }
    return bundle?.seriesDataSource ?? null;
  }, [bundle?.seriesDataSource, options.dataSource]);

  // ── Browse state (Stage 4.2O bespoke model — replaces shared useMediaBrowserModel) ──
  const [categories, setCategories] = useState<MediaCategory[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState(
    options.initialSelectedCategoryId ?? providerMemory.selectedCategoryId ?? '',
  );
  const [visibleItems, setVisibleItems] = useState<SeriesSummary[]>([]);
  const visibleItemsRef = useRef<SeriesSummary[]>([]);
  const [focusedItemId, setFocusedItemId] = useState<string | null>(
    options.initialFocusedSeriesId ?? providerMemory.focusedSeriesId,
  );
  const [selectedItemId, setSelectedItemId] = useState<string | null>(
    options.initialSelectedSeriesId ?? providerMemory.selectedSeriesId,
  );
  const [selectedItemSnapshot, setSelectedItemSnapshot] = useState<SeriesSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [browseLoadStatus, setBrowseLoadStatus] = useState<SeriesLoadStatus>('loading');
  const [browseLoadErrorMessage, setBrowseLoadErrorMessage] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [searchQuery, setSearchQueryState] = useState('');
  const [categoryHasRatings, setCategoryHasRatings] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [startupInteractive, setStartupInteractive] = useState(false);

  const offsetRef = useRef(0);
  const requestGenerationRef = useRef(0);
  const loadStatusRef = useRef<SeriesLoadStatus>(browseLoadStatus);
  loadStatusRef.current = browseLoadStatus;
  const focusedItemIdRef = useRef<string | null>(null);
  const selectedItemIdRef = useRef<string | null>(selectedItemId);
  const categoriesRef = useRef<MediaCategory[]>([]);
  const selectedCategoryIdRef = useRef(selectedCategoryId);
  selectedCategoryIdRef.current = selectedCategoryId;
  const previousListScopeRef = useRef({ providerId: '', categoryId: '' });
  const categoryCountRequestRef = useRef(new Set<string>());
  const pinnedSelectedItemIdRef = useRef<string | null>(
    options.initialSelectedSeriesId ?? providerMemory.selectedSeriesId,
  );

  /** Stage 4.2O: Series route mount clock + readiness (interactive before background refresh). */
  const routeMountedAtRef = useRef(Date.now());
  const startupStateRef = useRef({
    level: 'shell' as SeriesStartupReadinessLevel,
    durableCategoriesReady: false,
    firstViewportReady: false,
    interactive: false,
    backgroundRefreshStarted: false,
    backgroundRefreshFinished: false,
    categoriesElapsedMs: null as number | null,
    firstViewportElapsedMs: null as number | null,
    interactiveElapsedMs: null as number | null,
    startupMode: 'unavailable' as SeriesStartupQueryMode,
    categoryReplacements: 0,
    seriesReplacements: 0,
    budgetEmitted: false,
  });

  const emitStartup = useCallback(
    (event: string, payload: Record<string, unknown> = {}) => {
      emitSeriesStartup(activeProviderId, routeMountedAtRef.current, event, {
        marker: SERIES_FOCUS_STAGE4O_MARKER,
        ...payload,
      });
    },
    [activeProviderId],
  );

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
    markSeriesStartupSessionInteractive(activeProviderId);
    setStartupInteractive(true);
    emitStartup('series_startup_interactive', {
      startupSessionId: getSeriesStartupSession(activeProviderId)?.sessionId ?? null,
      marker: SERIES_FOCUS_STAGE4O1_MARKER,
      categoriesElapsedMs: state.categoriesElapsedMs,
      firstViewportElapsedMs: state.firstViewportElapsedMs,
      interactiveElapsedMs: state.interactiveElapsedMs,
      startupMode: state.startupMode,
      categoryReplacements: state.categoryReplacements,
      seriesReplacements: state.seriesReplacements,
    });
    if (!state.budgetEmitted) {
      state.budgetEmitted = true;
      const budgets = evaluateSeriesStartupBudgets({
        categoriesElapsedMs: state.categoriesElapsedMs,
        firstViewportElapsedMs: state.firstViewportElapsedMs,
        interactiveElapsedMs: state.interactiveElapsedMs,
        startupMode: state.startupMode,
        providerRefreshStillRunning: !state.backgroundRefreshFinished,
      });
      emitStartup('series_startup_budget_result', {
        categoriesElapsedMs: state.categoriesElapsedMs,
        firstViewportElapsedMs: state.firstViewportElapsedMs,
        interactiveElapsedMs: state.interactiveElapsedMs,
        ...budgets,
        startupMode: state.startupMode,
        providerRefreshStillRunning: !state.backgroundRefreshFinished,
      });
    }
  }, [activeProviderId, emitStartup]);

  // ── Stage 4.2O: route/provider mount — begin one startup session, log shell. ──
  useEffect(() => {
    routeMountedAtRef.current = Date.now();
    const session = beginSeriesStartupSession(activeProviderId);
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
      seriesReplacements: 0,
      budgetEmitted: false,
    };
    setStartupInteractive(false);
    emitStartup('series_startup_shell_mounted', {
      level: 'shell',
      startupSessionId: session.sessionId,
      marker: SERIES_FOCUS_STAGE4O1_MARKER,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProviderId]);

  useEffect(() => {
    categoriesRef.current = categories;
  }, [categories]);

  const reload = useCallback(() => {
    setReloadToken((current) => current + 1);
  }, []);

  const syncCategoryCount = useCallback((categoryId: string, count: number) => {
    if (!categoryId || count < 0) {
      return;
    }
    setCategories((current) =>
      current.map((category) => (category.id === categoryId ? { ...category, count, countKnown: true } : category)),
    );
  }, []);

  const prefetchCategoryCount = useCallback(
    (categoryId: string) => {
      if (
        !resolvedDataSource?.getCategoryCount ||
        !categoryId ||
        categoryId.startsWith('section:') ||
        categoryId.startsWith('smart:') ||
        categoryCountRequestRef.current.has(categoryId)
      ) {
        return;
      }
      categoryCountRequestRef.current.add(categoryId);
      void resolvedDataSource.getCategoryCount(categoryId).then((count) => {
        syncCategoryCount(categoryId, count);
      });
    },
    [resolvedDataSource, syncCategoryCount],
  );

  const queryMode = searchQuery.trim();
  const isSearchMode = queryMode.length > 0;

  // ── Stage 4.2O: durable-snapshot-first category load ──
  useEffect(() => {
    if (!resolvedDataSource) {
      return;
    }

    let mounted = true;
    let indexDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    const applyCategories = (next: MediaCategory[], startupMode: SeriesStartupQueryMode) => {
      const startup = startupStateRef.current;
      startup.categoryReplacements += 1;
      setCategories((current) => mergeSeriesCategoriesPreservingCounts(current, next));
      if (!startup.durableCategoriesReady) {
        startup.durableCategoriesReady = true;
        startup.level = 'durable-categories';
        startup.categoriesElapsedMs = Date.now() - routeMountedAtRef.current;
        startup.startupMode = startupMode;
        emitStartup('series_startup_durable_categories_ready', {
          categoryCount: next.length,
          categoriesElapsedMs: startup.categoriesElapsedMs,
          startupMode,
        });
      }
    };

    const loadCategoriesFromNetwork = async (reason: string) => {
      const startedAt = Date.now();
      logSeriesPerf('categories_load_start', { providerId: activeProviderId, reason });
      try {
        const nextCategories = await resolvedDataSource.getCategories();
        if (!mounted) {
          return nextCategories;
        }
        applyCategories(nextCategories, 'network-fallback');
        setBrowseLoadErrorMessage(null);
        void saveSeriesStartupDurableSnapshot({
          providerId: activeProviderId,
          generation: ++seriesCategoriesGenerationSeq,
          categories: nextCategories,
          selectedCategoryId: selectedCategoryIdRef.current || null,
          savedSeriesId: focusedItemIdRef.current,
          savedOffset: offsetRef.current,
          readableRowCount: nextCategories.length,
        });
        logSeriesPerf('categories_load_ready', {
          providerId: activeProviderId,
          categoryCount: nextCategories.length,
          elapsedMs: Date.now() - startedAt,
          reason,
        });
        return nextCategories;
      } catch (error) {
        if (!mounted) {
          return [];
        }
        logSeriesPerf('categories_load_error', {
          providerId: activeProviderId,
          elapsedMs: Date.now() - startedAt,
          message: error instanceof Error ? error.message : String(error),
        });
        if (categoriesRef.current.length === 0) {
          setCategories([]);
          setBrowseLoadStatus('error');
          setBrowseLoadErrorMessage(error instanceof Error ? error.message : 'Unable to load series categories.');
        }
        return null;
      }
    };

    const startupFastPath = async () => {
      // Fast path only applies to the first (non-reentrant) startup session.
      if (shouldBlockSeriesStartupReentry(activeProviderId)) {
        void loadCategoriesFromNetwork('reentry-runtime-refresh');
        return;
      }

      const memory = getMemorySeriesStartupSnapshot(activeProviderId);
      if (memory && memory.categories.length > 0) {
        applyCategories(memory.categories, 'memory-cache');
        emitStartup('series_startup_background_refresh_started', { reason: 'memory-cache-reconcile' });
        void loadCategoriesFromNetwork('memory-cache-reconcile').finally(() => {
          startupStateRef.current.backgroundRefreshFinished = true;
          emitStartup('series_startup_background_refresh_finished', { reason: 'memory-cache-reconcile' });
        });
        return;
      }

      const durable = await loadSeriesStartupDurableSnapshot(activeProviderId);
      if (!mounted) {
        return;
      }
      if (durable && durable.providerId === activeProviderId && durable.categories.length > 0) {
        applyCategories(durable.categories, 'durable-snapshot');
        emitStartup('series_startup_background_refresh_started', { reason: 'durable-snapshot-reconcile' });
        void loadCategoriesFromNetwork('durable-snapshot-reconcile').finally(() => {
          startupStateRef.current.backgroundRefreshFinished = true;
          emitStartup('series_startup_background_refresh_finished', { reason: 'durable-snapshot-reconcile' });
        });
        return;
      }

      // No local snapshot at all — must wait on the network for first paint.
      emitStartup('series_startup_network_fallback_started', { reason: 'no-local-snapshot' });
      setBrowseLoadStatus('loading');
      const loaded = await loadCategoriesFromNetwork('no-local-snapshot-startup');
      if (loaded) {
        startupStateRef.current.backgroundRefreshFinished = true;
      }
    };

    const scheduleSmartCountRefresh = () => {
      if (indexDebounceTimer) {
        clearTimeout(indexDebounceTimer);
      }
      indexDebounceTimer = setTimeout(() => {
        void refreshSmartSeriesCategoryCounts(activeProviderId, categoriesRef.current).then((refreshed) => {
          if (mounted) {
            setCategories((current) => mergeSeriesCategoriesPreservingCounts(current, refreshed));
          }
        });
      }, 500);
    };

    let reloadDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    const reloadSmartCategoryGridIfNeeded = () => {
      if (reloadDebounceTimer) {
        clearTimeout(reloadDebounceTimer);
      }
      reloadDebounceTimer = setTimeout(() => {
        if (isSmartCategoryId(selectedCategoryIdRef.current)) {
          setReloadToken((current) => current + 1);
        }
      }, 400);
    };

    void startupFastPath();

    const unsubscribeCounts = subscribeCategoryCountIndex(() => {
      if (!mounted) return;
      scheduleSmartCountRefresh();
    });
    const unsubscribeSmartCache = subscribeSmartCategoryCache(() => {
      if (!mounted) return;
      scheduleSmartCountRefresh();
      reloadSmartCategoryGridIfNeeded();
    });
    const unsubscribeSync = subscribeCatalogSyncPhase(activeProviderId, (phase) => {
      if (!mounted || phase === 'syncing') return;
      if (phase === 'ready' || phase === 'smart-building') {
        scheduleSmartCountRefresh();
        if (phase === 'ready') {
          reloadSmartCategoryGridIfNeeded();
        }
      }
    });
    const unsubscribeLibrary = subscribeMediaLibrary(() => {
      if (!mounted) return;
      scheduleSmartCountRefresh();
    });
    const unsubscribeSettings = subscribeMediaSettings(() => {
      if (!mounted) return;
      void loadCategoriesFromNetwork('settings-changed');
    });

    return () => {
      mounted = false;
      if (indexDebounceTimer) clearTimeout(indexDebounceTimer);
      if (reloadDebounceTimer) clearTimeout(reloadDebounceTimer);
      unsubscribeCounts();
      unsubscribeSmartCache();
      unsubscribeSync();
      unsubscribeLibrary();
      unsubscribeSettings();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProviderId, reloadToken, resolvedDataSource]);

  // ── Stage 4.2O: default-select a category once categories are known ──
  useEffect(() => {
    if (categories.length === 0) {
      return;
    }
    setSelectedCategoryId((current) => {
      if (current && categories.some((category) => category.id === current && category.kind !== 'section')) {
        return current;
      }
      const remembered = options.initialSelectedCategoryId ?? providerMemory.selectedCategoryId;
      if (remembered && categories.some((category) => category.id === remembered && category.kind !== 'section')) {
        return remembered;
      }
      return findDefaultBrowseCategoryId(categories);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories]);

  useEffect(() => {
    focusedItemIdRef.current = focusedItemId;
  }, [focusedItemId]);

  useEffect(() => {
    selectedItemIdRef.current = selectedItemId;
  }, [selectedItemId]);

  // ── Stage 4.2O: bounded first-viewport + category-switch page effect ──
  useEffect(() => {
    if (!resolvedDataSource || (!isSearchMode && (!selectedCategoryId || selectedCategoryId.startsWith('section:')))) {
      return;
    }
    if (!isSearchMode && categories.length === 0) {
      return;
    }

    let cancelled = false;
    const generation = ++requestGenerationRef.current;
    const requestKey = buildContentSortRequestKey({
      providerId: activeProviderId,
      contentType: 'series',
      categoryId: selectedCategoryId,
      sort: sortOption,
      offset: 0,
      generation,
    });
    const previousFocusedItemId = focusedItemIdRef.current;
    const retainVisible =
      !isSearchMode &&
      previousListScopeRef.current.providerId === activeProviderId &&
      previousListScopeRef.current.categoryId === selectedCategoryId;
    previousListScopeRef.current = { providerId: activeProviderId, categoryId: selectedCategoryId };

    const isStartupViewport = !isSearchMode && !startupStateRef.current.interactive;
    const pageLimit = isStartupViewport ? SERIES_STARTUP_VIEWPORT_LIMIT : 48;

    const loadInitialPage = async () => {
      const pageStartedAt = Date.now();
      if (!retainVisible) {
        setLoading(true);
        setCategoryLoading(true);
      }
      setBrowseLoadStatus(retainVisible ? loadStatusRef.current : 'loading');
      setBrowseLoadErrorMessage(null);
      setCategoryHasRatings(true);
      offsetRef.current = 0;

      logSeriesPerf('series_page_start', {
        providerId: activeProviderId,
        categoryId: selectedCategoryId,
        search: isSearchMode,
        pageLimit,
        queryPurpose: isStartupViewport ? 'startup-viewport' : 'runtime',
      });

      try {
        const page =
          isSearchMode && resolvedDataSource.searchSeries
            ? await resolvedDataSource.searchSeries({ query: queryMode, offset: 0, limit: pageLimit })
            : await resolvedDataSource.getSeriesPage({
                categoryId: selectedCategoryId,
                offset: 0,
                limit: pageLimit,
                sort: sortOption,
              });

        if (
          cancelled ||
          buildContentSortRequestKey({
            providerId: activeProviderId,
            contentType: 'series',
            categoryId: selectedCategoryId,
            sort: sortOption,
            offset: 0,
            generation,
          }) !== requestKey
        ) {
          return;
        }

        const startupSession = getSeriesStartupSession(activeProviderId);
        const dropLateStartup = shouldDropLateSeriesStartupFocusResult({
          startupInteractive: startupStateRef.current.interactive,
          startupFocusReleased: Boolean(startupSession?.focusReleased),
          detailOpen: false,
          detailClosing: false,
        });
        if (dropLateStartup && startupStateRef.current.interactive === false) {
          // Never true in practice (interactive is false here), kept for symmetry/testability.
        }

        offsetRef.current = page.items.length;
        startupStateRef.current.seriesReplacements += 1;
        setVisibleItems((current) => {
          const next = page.items;
          visibleItemsRef.current = next;
          logSeriesPerf('series_data_replaced', {
            reason: retainVisible ? 'category-first-page-replace' : 'category-first-page-load',
            previousLength: current.length,
            nextLength: next.length,
          });
          return next;
        });
        setHasMore(page.hasMore);
        if ('hasValidRatings' in page) {
          setCategoryHasRatings(Boolean((page as { hasValidRatings?: boolean }).hasValidRatings));
        }
        syncCategoryCount(selectedCategoryId, page.totalCount);

        if (!startupStateRef.current.interactive) {
          const startupFocus = resolveSeriesStartupFocusTarget({
            savedSeriesId: previousFocusedItemId,
            selectedSeriesId: selectedItemIdRef.current,
            viewportSeriesIds: page.items.map((series) => series.id),
            hasCategories: categoriesRef.current.length > 0,
          });
          if (!startupStateRef.current.firstViewportReady && page.items.length > 0) {
            startupStateRef.current.firstViewportReady = true;
            startupStateRef.current.level = 'first-viewport';
            startupStateRef.current.firstViewportElapsedMs = Date.now() - routeMountedAtRef.current;
            emitStartup('series_startup_first_viewport_ready', {
              categoryId: selectedCategoryId,
              returnedCount: page.items.length,
              firstViewportElapsedMs: startupStateRef.current.firstViewportElapsedMs,
              savedSeriesId: previousFocusedItemId,
              savedSeriesFound: startupFocus.reason === 'saved-focused',
            });
            emitStartup('series_startup_focus_target_selected', {
              seriesId: startupFocus.seriesId,
              reason: startupFocus.reason,
              fallbackUsed: startupFocus.fallbackUsed,
            });
          }
          setFocusedItemId(startupFocus.seriesId);
          if (page.items.length > 0) {
            markStartupInteractiveIfReady();
          }
        } else {
          const restoredFocusId =
            page.items.find((series) => series.id === previousFocusedItemId)?.id ?? page.items[0]?.id ?? null;
          setFocusedItemId(restoredFocusId);
        }

        setSelectedItemId((current) => {
          if (current && page.items.some((series) => series.id === current)) {
            return current;
          }
          if (current && pinnedSelectedItemIdRef.current === current) {
            return current;
          }
          return null;
        });

        setBrowseLoadStatus(page.items.length > 0 ? 'ready' : 'empty');
        logSeriesPerf('series_page_ready', {
          providerId: activeProviderId,
          categoryId: selectedCategoryId,
          itemCount: page.items.length,
          totalCount: page.totalCount,
          elapsedMs: Date.now() - pageStartedAt,
          pageLimit,
        });
      } catch (error) {
        if (
          cancelled ||
          buildContentSortRequestKey({
            providerId: activeProviderId,
            contentType: 'series',
            categoryId: selectedCategoryId,
            sort: sortOption,
            offset: 0,
            generation,
          }) !== requestKey
        ) {
          return;
        }
        setVisibleItems([]);
        visibleItemsRef.current = [];
        setHasMore(false);
        setBrowseLoadStatus('error');
        setBrowseLoadErrorMessage(error instanceof Error ? error.message : 'Unable to load series for this category.');
      } finally {
        if (
          !cancelled &&
          buildContentSortRequestKey({
            providerId: activeProviderId,
            contentType: 'series',
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
    // Stage 4.2O: intentionally excludes selectedItemId — read via
    // selectedItemIdRef so that Detail-origin selection (Play target) never
    // retriggers a full category-page reload while browsing. Mirrors the
    // Movies Stage 4.2N `selectedMovieIdRef` fix.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeProviderId,
    categories.length,
    isSearchMode,
    queryMode,
    reloadToken,
    resolvedDataSource,
    selectedCategoryId,
    sortOption,
  ]);

  const focusedItem = useMemo(
    () => visibleItems.find((series) => series.id === focusedItemId) ?? visibleItems[0] ?? null,
    [focusedItemId, visibleItems],
  );
  const selectedItem = useMemo(() => {
    const fromGrid = visibleItems.find((series) => series.id === selectedItemId) ?? null;
    if (fromGrid) {
      return fromGrid;
    }
    if (selectedItemSnapshot?.id === selectedItemId) {
      return selectedItemSnapshot;
    }
    return focusedItem;
  }, [focusedItem, selectedItemId, selectedItemSnapshot, visibleItems]);

  const browseLoadStatus2 = browseLoadStatus;

  const loadMore = useCallback(async () => {
    if (!resolvedDataSource || loading || !hasMore) {
      return;
    }
    const generationAtRequest = requestGenerationRef.current;
    const sortAtRequest = sortOption;
    const categoryAtRequest = selectedCategoryId;
    const providerAtRequest = activeProviderId;
    const nextOffset = offsetRef.current;
    setLoading(true);

    try {
      const page =
        isSearchMode && resolvedDataSource.searchSeries
          ? await resolvedDataSource.searchSeries({ query: queryMode, offset: nextOffset, limit: 48 })
          : await resolvedDataSource.getSeriesPage({
              categoryId: selectedCategoryId,
              offset: nextOffset,
              limit: 48,
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

      offsetRef.current += page.items.length;
      setVisibleItems((current) => {
        const next = uniqueSeries(current, page.items);
        visibleItemsRef.current = next;
        logSeriesPerf('series_pagination_appended', {
          previousLength: current.length,
          nextLength: next.length,
          appendedCount: page.items.length,
        });
        return next;
      });
      setHasMore(page.hasMore);
      if ('hasValidRatings' in page) {
        setCategoryHasRatings((current) => current || Boolean((page as { hasValidRatings?: boolean }).hasValidRatings));
      }
      syncCategoryCount(selectedCategoryId, page.totalCount);
      setBrowseLoadStatus((current) => (current === 'error' ? current : 'ready'));
      if (!focusedItemIdRef.current && page.items[0]) {
        setFocusedItemId(page.items[0].id);
      }
    } catch (error) {
      if (
        generationAtRequest !== requestGenerationRef.current ||
        sortAtRequest !== sortOption ||
        categoryAtRequest !== selectedCategoryId ||
        providerAtRequest !== activeProviderId
      ) {
        return;
      }
      setBrowseLoadStatus('error');
      setBrowseLoadErrorMessage(error instanceof Error ? error.message : 'Unable to load more series.');
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
  }, [activeProviderId, hasMore, isSearchMode, loading, queryMode, resolvedDataSource, selectedCategoryId, sortOption, syncCategoryCount]);

  const library = useMediaLibraryStore(activeProviderId);
  const [seriesDetail, setSeriesDetail] = useState<SeriesDetail | null>(null);
  const [selectedSeasonId, setSelectedSeasonId] = useState(providerMemory.selectedSeasonId ?? '');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const detailRequestIdRef = useRef(0);

  const loadSeriesDetail = useCallback(
    async (series: SeriesSummary) => {
      if (!resolvedDataSource) {
        return;
      }

      const requestId = ++detailRequestIdRef.current;
      setDetailLoading(true);
      setDetailError(null);

      try {
        const detail = await resolvedDataSource.getSeriesInfo(series.seriesId);
        if (requestId !== detailRequestIdRef.current) {
          return;
        }

        setSeriesDetail(detail);
        if (!detail) {
          setDetailError('Detailed series information is unavailable.');
        }

        const firstSeason = detail?.seasons[0]?.id ?? '';
        setSelectedSeasonId((current) => {
          if (current && detail?.episodesBySeason[current]) {
            return current;
          }
          return firstSeason;
        });

        if (detail) {
          void matchSeriesMetadata({
            providerId: activeProviderId,
            seriesId: series.seriesId,
            providerTitle: series.title,
          }).then((result) => {
            if (!result.metadata || requestId !== detailRequestIdRef.current) {
              return;
            }
            setSeriesDetail({
              ...detail,
              title: result.metadata.title || detail.title,
              description: result.metadata.overview || detail.description,
              year: result.metadata.year ? String(result.metadata.year) : detail.year,
              rating: result.metadata.rating ? `${result.metadata.rating}` : detail.rating,
              genres: result.metadata.genres.length ? result.metadata.genres : detail.genres,
              posterUrl: result.metadata.posterPath || detail.posterUrl,
              backdropUrl: result.metadata.backdropPath || detail.backdropUrl,
              creator: result.metadata.creator || detail.creator,
              network: result.metadata.network || detail.network,
              cast: result.metadata.cast?.length ? result.metadata.cast : detail.cast,
              runtimeMinutes: result.metadata.runtimeMinutes || detail.runtimeMinutes,
            });
          });
        }
      } catch {
        if (requestId === detailRequestIdRef.current) {
          setSeriesDetail(null);
          setDetailError('Detailed series information could not be loaded.');
        }
      } finally {
        if (requestId === detailRequestIdRef.current) {
          setDetailLoading(false);
        }
      }
    },
    [activeProviderId, resolvedDataSource],
  );

  const selectSeries = useCallback(
    (series: SeriesSummary) => {
      focusedItemIdRef.current = series.id;
      pinnedSelectedItemIdRef.current = series.id;
      setFocusedItemId(series.id);
      setSelectedItemId(series.id);
      setSelectedItemSnapshot(series);
      rememberSeriesScreenMemory(activeProviderId, {
        focusedSeriesId: series.id,
        selectedSeriesId: series.id,
      });
      void loadSeriesDetail(series);
    },
    [activeProviderId, loadSeriesDetail],
  );

  // Stage 4.2O: keep D-pad focus out of React state (matches Movies focusMovie) —
  // no setState here, only ref + memory, so browsing posters never re-renders the grid.
  const focusSeries = useCallback(
    (series: SeriesSummary) => {
      focusedItemIdRef.current = series.id;
      rememberSeriesScreenMemory(activeProviderId, { focusedSeriesId: series.id });
    },
    [activeProviderId],
  );

  const selectCategory = useCallback(
    (categoryId: string) => {
      if (categoryId === selectedCategoryId && !isSearchMode) {
        return;
      }
      setSearchQueryState('');
      pinnedSelectedItemIdRef.current = null;
      setSelectedItemSnapshot(null);
      setSelectedItemId(null);
      setSelectedCategoryId(categoryId);
      setBrowseLoadStatus('loading');
      setBrowseLoadErrorMessage(null);
      const category = categoriesRef.current.find((entry) => entry.id === categoryId);
      if (category?.countKnown === false) {
        prefetchCategoryCount(categoryId);
      }
      rememberSeriesScreenMemory(activeProviderId, { selectedCategoryId: categoryId });
      logSeriesPerf('series_category_selected', { categoryId });
    },
    [activeProviderId, isSearchMode, prefetchCategoryCount, selectedCategoryId],
  );

  const selectSeason = useCallback(
    (seasonId: string) => {
      setSelectedSeasonId(seasonId);
      rememberSeriesScreenMemory(activeProviderId, { selectedSeasonId: seasonId });
    },
    [activeProviderId],
  );

  const continueWatching = useMemo(() => {
    if (!selectedItem) {
      return null;
    }
    return library.seriesContinueWatching(selectedItem.seriesId);
  }, [selectedItem, library]);

  const setSort = useCallback((next: ContentSortOption) => {
    void setSeriesSortOption(next);
  }, []);

  useEffect(() => {
    if (sortOption === 'rating-desc' && !categoryHasRatings) {
      void setSeriesSortOption('newest');
    }
  }, [categoryHasRatings, sortOption]);

  const setSearchQuery = useCallback((next: string) => {
    setSearchQueryState(next);
  }, []);

  return {
    categories: resolvedDataSource ? categories : [],
    selectedCategoryId,
    visibleItems: resolvedDataSource ? visibleItems : [],
    focusedItem: resolvedDataSource ? focusedItem : null,
    selectedItem: resolvedDataSource ? selectedItem : null,
    loading: resolvedDataSource ? loading : false,
    categoryLoading: resolvedDataSource ? categoryLoading : false,
    loadStatus: resolvedDataSource ? browseLoadStatus2 : 'error',
    loadErrorMessage: resolvedDataSource ? browseLoadErrorMessage : 'Provider is not connected.',
    hasMore: resolvedDataSource ? hasMore : false,
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
    isSelectedFavorite: selectedItem ? library.isFavorite(selectedItem.seriesId) : false,
    isSelectedWatchlisted: selectedItem ? library.isWatchlisted(selectedItem.seriesId) : false,
    hasDataSource: Boolean(resolvedDataSource),
    bundle,
    activeProviderId,
    sortOption,
    setSort,
    categoryHasRatings,
    searchQuery,
    setSearchQuery,
    /** Stage 4.2O: true once durable categories + first viewport are ready. */
    startupInteractive,
    getStartupDiagnostics: () => ({ ...startupStateRef.current }),
  };
}
