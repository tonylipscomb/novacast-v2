import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useProviderStore } from '@/features/providers/providerStore';
import { useActiveProviderBundle } from '@/features/providers/useActiveProviderBundle';

import type { MovieDataSource } from './data/MovieDataSource';
import { createSqliteMovieDataSource } from './data/SqliteMovieDataSource';
import { MOVIE_PAGE_SIZE } from './movieMockData';
import type { MovieCategory, MovieSummary } from './movieTypes';
import { resolvePlaybackMovieId, resolveSelectedMovie, type MoviesLoadStatus } from './moviesScreenLogic';
import { getMoviesScreenMemory, rememberMoviesScreenMemory } from './moviesScreenMemory';
import {
  createSmartMovieDataSource,
  findDefaultCategoryId,
  refreshSmartCategoryCounts,
} from './smart/SmartMovieDataSource';
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
} from '@/features/providers/providerCatalogSync';
import { subscribeSmartCategoryCache } from '@/features/providers/smartCategoryCacheStore';
import { isSmartCategoryId, normalizeSelectedSmartCategoryId } from '@/features/media-browser/mediaCategoryUtils';
import {
  categoriesNeedingCountWarm,
  createSerialCategoryCountQueue,
  shouldNetworkFetchCategoryCountOnWarm,
  shouldPrefetchMovieCategoryCount,
} from './movieCategoryCountPolicy';

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
    return previous;
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

function isSelectableCategory(category: MovieCategory) {
  return category.kind !== 'section';
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
  const resolvedDataSource = useMemo(() => {
    if (dataSource) {
      return dataSource;
    }

    if (MOVIES_SQLITE_READS_ENABLED && selectedProvider?.id) {
      console.info('[Movies SQLite] selected', {
        providerId: selectedProvider.id,
      });
      return createSmartMovieDataSource(
        createSqliteMovieDataSource(selectedProvider.id),
        selectedProvider.id,
      );
    }

    if (activeBundle?.movies) {
      return activeBundle.movies;
    }

    return null;
  }, [activeBundle?.movies, dataSource, selectedProvider?.id]);
  const providerMemory = getMoviesScreenMemory(activeProviderId);
  const [categories, setCategories] = useState<MovieCategory[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState(
    normalizeSelectedSmartCategoryId(options.initialSelectedCategoryId ?? providerMemory.selectedCategoryId) ?? '',
  );
  const [visibleMovies, setVisibleMovies] = useState<MovieSummary[]>([]);
  const visibleMoviesRef = useRef<MovieSummary[]>([]);
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

  const updateVisibleMovies = useCallback(
    (
      updater: MovieSummary[] | ((current: MovieSummary[]) => MovieSummary[]),
      reason: string,
    ) => {
      setVisibleMovies((current) => {
        const next = typeof updater === 'function' ? updater(current) : updater;
        visibleMoviesRef.current = next;
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
        return next;
      });
    },
    [],
  );
  const selectedCategoryIdRef = useRef(selectedCategoryId);
  selectedCategoryIdRef.current = selectedCategoryId;
  const previousListScopeRef = useRef({ providerId: '', categoryId: '' });
  const categoriesRef = useRef<MovieCategory[]>([]);
  const hideSmartCategoriesRef = useRef(settings.hideSmartCategories);

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
      logMoviesPerf('categories_load_start', { providerId: activeProviderId });
      try {
        const nextCategories = await resolvedDataSource.getCategories();
        if (!mounted) {
          return;
        }

        const warmedCategories = warmUnresolvedCategoryCounts(nextCategories);
        setCategories((current) => mergeCategoriesPreservingCounts(current, warmedCategories));
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
              reason: warmedCategories.length ? 'model-apply' : 'empty-refresh-preserved',
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
        scheduleSmartCountRefresh();
        setSelectedCategoryId((current) => {
          let nextId = current;
          if (current && current !== 'all' && warmedCategories.some((category) => category.id === current && isSelectableCategory(category))) {
            nextId = current;
          } else {
            const remembered = options.initialSelectedCategoryId ?? providerMemory.selectedCategoryId;
            if (remembered && warmedCategories.some((category) => category.id === remembered && isSelectableCategory(category))) {
              nextId = remembered;
            } else {
              nextId = findDefaultCategoryId(warmedCategories);
            }
          }

          const selected = warmedCategories.find((category) => category.id === nextId);
          const indexedSelected =
            selected?.kind === 'provider'
              ? getCategoryCountFromIndex(activeProviderId, 'movie', selected.id)
              : undefined;
          if (selected && selected.countKnown === false && indexedSelected == null) {
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
        setCategories([]);
        setLoadStatus('error');
        setLoadErrorMessage(error instanceof Error ? error.message : 'Unable to load movie categories.');
      }
    };

    const scheduleSmartCountRefresh = () => {
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
      logMoviesPerf('catalog_ready_received', { providerId: activeProviderId });
      void loadCategories();
      reloadSmartCategoryGridIfNeeded();
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
      if (!mounted || phase === 'syncing') {
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
      unsubscribeLibrary();
      unsubscribeSettings();
    };
  }, [activeProviderId, resolvedDataSource]);

  useEffect(() => {
    focusedMovieIdRef.current = focusedMovieId;
  }, [focusedMovieId]);

  useEffect(() => {
    if (!resolvedDataSource || (!isSearchMode && (!selectedCategoryId || selectedCategoryId.startsWith('section:')))) {
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

      try {
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
              });

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

        offsetRef.current = page.items.length;
        updateVisibleMovies(page.items, retainVisible ? 'category-first-page-replace' : 'category-first-page-load');
        setHasMore(page.hasMore);
        if ('hasValidRatings' in page) {
          setCategoryHasRatings(Boolean(page.hasValidRatings));
        }
        syncCategoryCount(selectedCategoryId, page.totalCount);
        // Resolve gate only for this request token — stale completions cannot hide a newer loader.
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
        logMoviesPerf('movies_page_ready', {
          providerId: activeProviderId,
          categoryId: selectedCategoryId,
          itemCount: page.items.length,
          totalCount: page.totalCount,
          elapsedMs: Date.now() - pageStartedAt,
          countQueue: categoryCountQueueRef.current?.getStats() ?? null,
        });
        const restoredFocusId =
          page.items.find((movie) => movie.id === previousFocusedMovieId)?.id ?? page.items[0]?.id ?? null;
        setFocusedMovieId(restoredFocusId);
        setSelectedMovieId((current) => {
          if (current && page.items.some((movie) => movie.id === current)) {
            return current;
          }

          // Focus restoration is browse chrome. Selection is created only by
          // explicit poster activation.
          return null;
        });
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
        if (!cancelled && buildContentSortRequestKey({
          providerId: activeProviderId,
          contentType: 'movie',
          categoryId: selectedCategoryId,
          sort: sortOption,
          offset: 0,
          generation,
        }) === requestKey) {
          setLoading(false);
          setCategoryLoading(false);
        }
      }
    };

    void loadInitialPage();

    return () => {
      cancelled = true;
    };
  }, [activeProviderId, categories.length, isSearchMode, queryMode, reloadToken, resolvedDataSource, selectedCategoryId, sortOption, syncCategoryCount, updateVisibleMovies]);

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
    async (movie: MovieSummary) => {
      const requestId = ++detailRequestIdRef.current;
      const fallback = buildMoviePreviewDetail(movie);
      console.info('[NovaCast Movies Detail Load]', {
        phase: 'start',
        providerId: activeProviderId,
        movieId: movie.id,
        summaryHasProviderId: Boolean((movie as MovieSummary & { providerId?: string }).providerId),
        summaryHasContentId: Boolean(movie.id),
        summaryHasContainerExtension: Boolean(movie.containerExtension),
        requestAction: resolvedDataSource?.getMovieInfo ? 'getMovieInfo' : 'preview-only',
      });
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
        });
        if (!detail && resolvedDataSource?.getMovieInfo) {
          setDetailError('Detailed movie information is unavailable.');
        }
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
        });
        if (requestId === detailRequestIdRef.current) {
          setMovieDetail(fallback);
          setDetailError('Detailed movie information could not be loaded.');
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

      offsetRef.current += page.items.length;
      updateVisibleMovies((current) => uniqueMovies(current, page.items), 'pagination-append');
      setHasMore(page.hasMore);
      if ('hasValidRatings' in page) {
        setCategoryHasRatings((current) => current || Boolean(page.hasValidRatings));
      }
      syncCategoryCount(selectedCategoryId, page.totalCount);
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

  return {
    categories: resolvedDataSource ? categories : [],
    selectedCategoryId,
    focusedMovie: resolvedDataSource ? focusedMovie : null,
    selectedMovie: resolvedDataSource ? selectedMovie : null,
    selectedMovieId: resolvedDataSource ? selectedMovieId : null,
    visibleMovies: resolvedDataSource ? visibleMovies : [],
    loading: resolvedDataSource ? loading : false,
    categoryLoading: resolvedDataSource ? categoryLoading : false,
    loadStatus: resolvedDataSource ? loadStatus : 'error',
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
    reload,
    searchQuery,
    setSearchQuery,
    sortOption,
    setSort,
    categoryHasRatings,
    hasDataSource: Boolean(resolvedDataSource),
  };
}
