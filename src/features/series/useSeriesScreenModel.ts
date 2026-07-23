import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useProviderStore } from '@/features/providers/providerStore';
import { useActiveProviderBundle } from '@/features/providers/useActiveProviderBundle';
import { useMediaBrowserModel, type MediaDataSource } from '@/features/media-browser/useMediaBrowserModel';
import type { MediaCategory, SeriesDetail, SeriesSummary } from '@/features/media-browser/mediaTypes';
import { useMediaLibraryStore, subscribeMediaLibrary } from '@/features/media-browser/mediaLibraryStore';
import { setSeriesSortOption, subscribeMediaSettings, useMediaSettingsStore } from '@/features/media-browser/mediaSettingsStore';
import type { ContentSortOption } from '@/features/media-browser/contentSorting';
import {
  refreshSmartSeriesCategoryCounts,
} from '@/features/series/smart/SmartSeriesDataSource';
import { subscribeCategoryCountIndex } from '@/features/providers/categoryCountIndexStore';
import { subscribeCatalogSyncPhase } from '@/features/providers/providerCatalogSync';
import { subscribeSmartCategoryCache } from '@/features/providers/smartCategoryCacheStore';
import { isSmartCategoryId } from '@/features/media-browser/mediaCategoryUtils';
import type { SeriesDataSource } from './data/SeriesDataSource';
import { getSeriesScreenMemory, rememberSeriesScreenMemory } from './seriesScreenMemory';
import { matchSeriesMetadata } from './metadata/seriesMetadataMatcher';

export type UseSeriesScreenModelOptions = {
  dataSource?: SeriesDataSource;
  initialSelectedCategoryId?: string;
  initialFocusedSeriesId?: string | null;
  initialSelectedSeriesId?: string | null;
};

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

  const browserDataSource = useMemo<MediaDataSource<SeriesSummary> | null>(() => {
    if (!resolvedDataSource) {
      return null;
    }

    return {
      getCategories: () => resolvedDataSource.getCategories(),
      getItemsPage: (input) => resolvedDataSource.getSeriesPage({ ...input, sort: sortOption }),
      searchItems: resolvedDataSource.searchSeries
        ? (input) => resolvedDataSource.searchSeries!(input)
        : undefined,
      getCategoryCount: resolvedDataSource.getCategoryCount?.bind(resolvedDataSource),
      prefetchAllCategoryCounts: resolvedDataSource.prefetchAllCategoryCounts?.bind(resolvedDataSource),
    };
  }, [resolvedDataSource, sortOption]);

  const browser = useMediaBrowserModel<SeriesSummary>(browserDataSource, {
    initialSelectedCategoryId: options.initialSelectedCategoryId ?? providerMemory.selectedCategoryId,
    initialFocusedItemId: options.initialFocusedSeriesId ?? providerMemory.focusedSeriesId,
    initialSelectedItemId: options.initialSelectedSeriesId ?? providerMemory.selectedSeriesId,
    pageSize: 48,
    sortOption,
    providerId: activeProviderId,
  });
  const browserRef = useRef(browser);
  browserRef.current = browser;

  const library = useMediaLibraryStore(activeProviderId);
  const [categories, setCategories] = useState<MediaCategory[]>(browser.categories);
  const [categoryLoadStatus, setCategoryLoadStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [categoryLoadError, setCategoryLoadError] = useState<string | null>(null);
  const [categoryReloadToken, setCategoryReloadToken] = useState(0);
  const [seriesDetail, setSeriesDetail] = useState<SeriesDetail | null>(null);
  const [selectedSeasonId, setSelectedSeasonId] = useState(providerMemory.selectedSeasonId ?? '');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const detailRequestIdRef = useRef(0);

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

        setCategories(nextCategories);
        setCategoryLoadStatus('ready');
        setCategoryLoadError(null);
      } catch (error) {
        if (!mounted) {
          return;
        }

        setCategories([]);
        setCategoryLoadStatus('error');
        setCategoryLoadError(error instanceof Error ? error.message : 'Unable to load series categories.');
      }
    };

    const scheduleSmartCountRefresh = () => {
      if (indexDebounceTimer) {
        clearTimeout(indexDebounceTimer);
      }

      indexDebounceTimer = setTimeout(() => {
        setCategories((current) => {
          void refreshSmartSeriesCategoryCounts(activeProviderId, current).then((refreshed) => {
            if (mounted) {
              setCategories(refreshed);
            }
          });
          return current;
        });
      }, 500);
    };

    let reloadDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    const reloadSmartCategoryGridIfNeeded = () => {
      if (reloadDebounceTimer) {
        clearTimeout(reloadDebounceTimer);
      }

      reloadDebounceTimer = setTimeout(() => {
        const categoryId = browserRef.current.selectedCategoryId;
        if (isSmartCategoryId(categoryId)) {
          browserRef.current.reload();
        }
      }, 400);
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

    const unsubscribeLibrary = subscribeMediaLibrary(() => {
      if (!mounted) {
        return;
      }
      scheduleSmartCountRefresh();
    });

    const unsubscribeSettings = subscribeMediaSettings(() => {
      if (!mounted) {
        return;
      }
      void loadCategories();
    });

    return () => {
      mounted = false;
      if (indexDebounceTimer) {
        clearTimeout(indexDebounceTimer);
      }
      if (reloadDebounceTimer) {
        clearTimeout(reloadDebounceTimer);
      }
      unsubscribeCounts();
      unsubscribeSmartCache();
      unsubscribeSync();
      unsubscribeLibrary();
      unsubscribeSettings();
    };
  }, [activeProviderId, categoryReloadToken, resolvedDataSource]);

  const reload = useCallback(() => {
    browserRef.current.reload();
    setCategoryReloadToken((current) => current + 1);
  }, []);

  const loadStatus =
    categoryLoadStatus === 'error' && categories.length === 0
      ? 'error'
      : browser.loadStatus;
  const loadErrorMessage = categoryLoadError ?? browser.loadErrorMessage;

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
      browserRef.current.selectItem(series);
      rememberSeriesScreenMemory(activeProviderId, {
        focusedSeriesId: series.id,
        selectedSeriesId: series.id,
      });
      void loadSeriesDetail(series);
    },
    [activeProviderId, loadSeriesDetail],
  );

  const focusSeries = useCallback(
    (series: SeriesSummary) => {
      rememberSeriesScreenMemory(activeProviderId, { focusedSeriesId: series.id });
    },
    [activeProviderId],
  );

  const selectCategory = useCallback(
    (categoryId: string) => {
      browserRef.current.selectCategory(categoryId);
      rememberSeriesScreenMemory(activeProviderId, { selectedCategoryId: categoryId });
    },
    [activeProviderId],
  );

  const selectSeason = useCallback(
    (seasonId: string) => {
      setSelectedSeasonId(seasonId);
      rememberSeriesScreenMemory(activeProviderId, { selectedSeasonId: seasonId });
    },
    [activeProviderId],
  );

  const continueWatching = useMemo(() => {
    if (!browser.selectedItem) {
      return null;
    }
    return library.seriesContinueWatching(browser.selectedItem.seriesId);
  }, [browser.selectedItem, library]);

  const setSort = useCallback((next: ContentSortOption) => {
    void setSeriesSortOption(next);
  }, []);

  useEffect(() => {
    if (sortOption === 'rating-desc' && !browser.categoryHasRatings) {
      void setSeriesSortOption('newest');
    }
  }, [browser.categoryHasRatings, sortOption]);

  return {
    categories: resolvedDataSource ? categories : [],
    selectedCategoryId: browser.selectedCategoryId,
    visibleItems: browser.visibleItems,
    focusedItem: browser.focusedItem,
    selectedItem: browser.selectedItem,
    loading: browser.loading,
    categoryLoading: browser.categoryLoading,
    loadStatus,
    loadErrorMessage,
    hasMore: browser.hasMore,
    selectCategory,
    prefetchCategoryCount: browser.prefetchCategoryCount,
    focusSeries,
    selectSeries,
    loadMore: browser.loadMore,
    reload,
    seriesDetail,
    selectedSeasonId,
    selectSeason,
    detailLoading,
    detailError,
    loadSeriesDetail,
    continueWatching,
    hasDataSource: Boolean(resolvedDataSource),
    bundle,
    activeProviderId,
    sortOption,
    setSort,
    categoryHasRatings: browser.categoryHasRatings,
  };
}
