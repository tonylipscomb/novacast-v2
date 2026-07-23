import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useProviderStore } from '@/features/providers/providerStore';
import { useActiveProviderBundle } from '@/features/providers/useActiveProviderBundle';

import type { MovieDataSource } from './data/MovieDataSource';
import { MOVIE_PAGE_SIZE } from './movieMockData';
import type { MovieCategory, MovieSummary } from './movieTypes';
import { resolvePlaybackMovieId, resolveSelectedMovie, type MoviesLoadStatus } from './moviesScreenLogic';
import { getMoviesScreenMemory, rememberMoviesScreenMemory } from './moviesScreenMemory';
import {
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
import { subscribeCategoryCountIndex } from '@/features/providers/categoryCountIndexStore';
import { subscribeCatalogSyncPhase } from '@/features/providers/providerCatalogSync';
import { subscribeSmartCategoryCache } from '@/features/providers/smartCategoryCacheStore';
import { isSmartCategoryId, normalizeSelectedSmartCategoryId } from '@/features/media-browser/mediaCategoryUtils';

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

function applyCategoryCount(categories: MovieCategory[], categoryId: string, count: number) {
  return categories.map((category) => (category.id === categoryId ? { ...category, count, countKnown: true } : category));
}

function mergeCategoriesPreservingCounts(previous: MovieCategory[], next: MovieCategory[]) {
  if (!previous.length) {
    return next;
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

    if (activeBundle?.movies) {
      return activeBundle.movies;
    }

    return null;
  }, [activeBundle?.movies, dataSource]);
  const providerMemory = getMoviesScreenMemory(activeProviderId);
  const [categories, setCategories] = useState<MovieCategory[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState(
    normalizeSelectedSmartCategoryId(options.initialSelectedCategoryId ?? providerMemory.selectedCategoryId) ?? '',
  );
  const [visibleMovies, setVisibleMovies] = useState<MovieSummary[]>([]);
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

  const offsetRef = useRef(0);
  const requestGenerationRef = useRef(0);
  const loadStatusRef = useRef<MoviesLoadStatus>(loadStatus);
  loadStatusRef.current = loadStatus;
  const focusedMovieIdRef = useRef<string | null>(null);
  const categoryCountRequestRef = useRef(new Set<string>());
  const detailRequestIdRef = useRef(0);
  const [reloadToken, setReloadToken] = useState(0);
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
      try {
        const nextCategories = await resolvedDataSource.getCategories();
        if (!mounted) {
          return;
        }

        setCategories((current) => mergeCategoriesPreservingCounts(current, nextCategories));
        setSelectedCategoryId((current) => {
          if (current && current !== 'all' && nextCategories.some((category) => category.id === current && isSelectableCategory(category))) {
            return current;
          }

          const remembered = options.initialSelectedCategoryId ?? providerMemory.selectedCategoryId;
          if (remembered && nextCategories.some((category) => category.id === remembered && isSelectableCategory(category))) {
            return remembered;
          }

          return findDefaultCategoryId(nextCategories);
        });
      } catch (error) {
        if (!mounted) {
          return;
        }

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
        if (phase === 'ready') {
          reloadSmartCategoryGridIfNeeded();
        }
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
      unsubscribeLibrary();
      unsubscribeSettings();
    };
  }, [activeProviderId, options.initialSelectedCategoryId, providerMemory.selectedCategoryId, resolvedDataSource]);

  useEffect(() => {
    focusedMovieIdRef.current = focusedMovieId;
  }, [focusedMovieId]);

  useEffect(() => {
    if (!resolvedDataSource || (!isSearchMode && (!selectedCategoryId || selectedCategoryId.startsWith('section:')))) {
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

    const loadInitialPage = async () => {
      await Promise.resolve();

      setLoading(true);
      setCategoryLoading(true);
      setLoadStatus(retainVisible ? loadStatusRef.current : 'loading');
      setLoadErrorMessage(null);
      if (!retainVisible) {
        setVisibleMovies([]);
      }
      setCategoryHasRatings(true);
      offsetRef.current = 0;

      logMoviesAction('page-requested', {
        categoryId: selectedCategoryId,
        offset: 0,
        limit: MOVIE_PAGE_SIZE,
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
        setVisibleMovies(page.items);
        setHasMore(page.hasMore);
        if ('hasValidRatings' in page) {
          setCategoryHasRatings(Boolean(page.hasValidRatings));
        }
        syncCategoryCount(selectedCategoryId, page.totalCount);
        const restoredFocusId =
          page.items.find((movie) => movie.id === previousFocusedMovieId)?.id ?? page.items[0]?.id ?? null;
        setFocusedMovieId(restoredFocusId);
        setSelectedMovieId((current) => {
          if (current && page.items.some((movie) => movie.id === current)) {
            return current;
          }

          return restoredFocusId;
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

        setVisibleMovies([]);
        setHasMore(false);
        setLoadStatus('error');
        setLoadErrorMessage(error instanceof Error ? error.message : 'Unable to load movies for this category.');
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
  }, [activeProviderId, isSearchMode, queryMode, reloadToken, resolvedDataSource, selectedCategoryId, sortOption, syncCategoryCount]);

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
      setMovieDetail(fallback);
      setDetailError(null);
      setDetailLoading(true);

      try {
        const detail = await resolvedDataSource?.getMovieInfo?.(movie.id);
        if (requestId !== detailRequestIdRef.current) {
          return;
        }

        setMovieDetail(detail ?? fallback);
        if (!detail && resolvedDataSource?.getMovieInfo) {
          setDetailError('Detailed movie information is unavailable.');
        }
      } catch {
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
    [resolvedDataSource],
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
    rememberMoviesScreenMemory(activeProviderId, {
      selectedCategoryId: categoryId,
    });
  };

  const focusMovie = (movie: MovieSummary) => {
    logMoviesAction('movie-focused', { movieId: movie.id });
    focusedMovieIdRef.current = movie.id;
    setFocusedMovieId(movie.id);
    rememberMoviesScreenMemory(activeProviderId, {
      focusedMovieId: movie.id,
    });
  };

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
      setVisibleMovies((current) => uniqueMovies(current, page.items));
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
    resolvePlaybackMovieId: () => resolvePlaybackMovieId(selectedMovieId, focusedMovieId),
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
