import type { MovieDataSource } from '../data/MovieDataSource.ts';
import type { MovieSummary, MovieCategory } from '../movieTypes.ts';
import { SMART_CATEGORY_PREFIX } from '../movieTypes.ts';
import type { MediaDetail } from '../../media-browser/mediaTypes.ts';
import {
  buildContentSortPageMetadata,
  categoryHasValidRatings,
  DEFAULT_CONTENT_SORT,
  paginateSortedItems,
  sortContentItems,
  type ContentSortOption,
} from '../../media-browser/contentSorting.ts';
import { findDefaultBrowseCategoryId } from '../../media-browser/mediaCategoryUtils.ts';
import { getCategoryCountFromIndex } from '../../providers/categoryCountIndexStore.ts';
import { fallbackProviderCategoryId } from '../../providers/categoryNormalization.ts';
import { sortProviderCategoriesUsFirst, partitionMediaSummariesUsFirst } from '../../providers/usAmericanSort.ts';
import {
  getSmartCategoryCountSync,
  getSmartCategoryEntrySync,
  getSmartCategoryCacheSync,
} from '../../providers/smartCategoryCacheStore.ts';
import { loadAllMoviesForCatalogIndex } from '../../providers/catalogCategoryLoader.ts';
import { logSmartCategoryCatalogAudit } from '../../providers/catalogSyncAudit.ts';
import { searchMovies as searchMoviesRepository } from '../../search/repositories/movieSearchRepository.ts';
import { entryToSummary, getMovieCatalogIndex, type MovieCatalogEntry } from './movieCatalogIndex.ts';
import {
  getContinueWatchingIds,
  getFavoriteIds,
  getLastWatchedMovie,
  getRecentlyWatchedIds,
  getWatchlistIds,
} from './movieLibraryStore.ts';
import { getMoviesSettings } from './moviesSettingsStore.ts';
import {
  buildSmartCategoryContext,
  getActiveSmartCategoryDefinitions,
  querySmartCategoryOnIndex,
  resolveSmartCategoryDefinition,
} from './smartCategoryDefinitions.ts';

export const SECTION_DISCOVER_ID = 'section:discover';
export const SECTION_PROVIDER_ID = 'section:provider';

function appendFallbackCategory(categories: MovieCategory[], providerId: string) {
  const id = fallbackProviderCategoryId('movie');
  const count = getCategoryCountFromIndex(providerId, 'movie', id);
  if (count == null || count <= 0 || categories.some((category) => category.id === id)) {
    return categories;
  }

  return [
    ...categories,
    {
      id,
      renderKey: `${id}::fallback`,
      name: 'Uncategorized',
      count,
      countKnown: true,
      kind: 'provider' as const,
      section: 'provider' as const,
    },
  ];
}

const indexListeners = new Map<string, Set<() => void>>();

function isSmartCategoryId(categoryId: string) {
  return categoryId.startsWith(SMART_CATEGORY_PREFIX);
}

function isSectionCategoryId(categoryId: string) {
  return categoryId.startsWith('section:');
}

function isProviderCategoryId(categoryId: string) {
  return !isSmartCategoryId(categoryId) && !isSectionCategoryId(categoryId);
}

export function subscribeCatalogIndex(providerId: string, listener: () => void) {
  const listeners = indexListeners.get(providerId) ?? new Set();
  listeners.add(listener);
  indexListeners.set(providerId, listeners);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      indexListeners.delete(providerId);
    }
  };
}

async function buildLibraryContext(providerId: string) {
  const [favorites, watchlist, continueWatching, recentlyWatched, lastWatched] = await Promise.all([
    getFavoriteIds(providerId),
    getWatchlistIds(providerId),
    getContinueWatchingIds(providerId),
    getRecentlyWatchedIds(providerId),
    getLastWatchedMovie(providerId),
  ]);

  const index = getMovieCatalogIndex(providerId);
  const lastEntry = lastWatched ? index.getEntry(lastWatched.movieId) : undefined;

  return buildSmartCategoryContext({
    providerId,
    favorites,
    watchlist,
    continueWatching,
    recentlyWatched,
    lastWatchedGenres: lastEntry?.genreTags ?? [],
  });
}

function detailToMovieSummary(detail: MediaDetail): MovieSummary {
  const yearNumber = detail.year ? Number.parseInt(detail.year, 10) : undefined;

  return {
    id: detail.id,
    categoryId: '',
    title: detail.title,
    year: Number.isFinite(yearNumber) ? yearNumber : undefined,
    releaseDate: detail.releaseDate,
    rating: detail.rating != null ? String(detail.rating) : undefined,
    genres: detail.genres.length ? detail.genres : ['Movies'],
    description: detail.synopsis ?? 'Curated from your NovaCast movie library.',
    posterStyleKey: 'ember',
    posterUrl: detail.posterUrl,
    score: detail.rating,
  };
}

async function resolveSummariesFromCachedIds(
  itemIds: string[],
  index: ReturnType<typeof getMovieCatalogIndex>,
  base: MovieDataSource,
) {
  const resolved = new Map(index.getSummaries(itemIds).map((summary) => [summary.id, summary]));
  const missing = itemIds.filter((id) => !resolved.has(id));

  if (!missing.length || !base.getMovieInfo) {
    return itemIds.map((id) => resolved.get(id)).filter((summary): summary is MovieSummary => Boolean(summary));
  }

  const batchSize = 4;
  for (let offset = 0; offset < missing.length; offset += batchSize) {
    const batch = missing.slice(offset, offset + batchSize);
    const details = await Promise.all(batch.map((id) => base.getMovieInfo!(id).catch(() => null)));
    for (let indexInBatch = 0; indexInBatch < batch.length; indexInBatch += 1) {
      const detail = details[indexInBatch];
      if (!detail) {
        continue;
      }

      const summary = detailToMovieSummary(detail);
      resolved.set(batch[indexInBatch], summary);
      index.ingest([summary]);
    }
  }

  return itemIds.map((id) => resolved.get(id)).filter((summary): summary is MovieSummary => Boolean(summary));
}

export function createSmartMovieDataSource(base: MovieDataSource, providerId: string): MovieDataSource {
  async function buildSmartCategories(providerCategories: MovieCategory[]) {
    const sortedProviderCategories = sortProviderCategoriesUsFirst(providerCategories, 'movie');
    const settings = await getMoviesSettings();
    if (settings.hideSmartCategories) {
      return appendFallbackCategory(sortedProviderCategories.map((category) => ({
        ...category,
        kind: 'provider' as const,
        section: 'provider' as const,
        count: getCategoryCountFromIndex(providerId, 'movie', category.id) ?? category.count,
        countKnown: getCategoryCountFromIndex(providerId, 'movie', category.id) !== undefined || category.countKnown !== false,
      })), providerId);
    }

    const definitions = getActiveSmartCategoryDefinitions();
    const smartCache = getSmartCategoryCacheSync(providerId, 'movie');

    const smartCategories: MovieCategory[] = definitions.map((definition) => ({
      id: `${SMART_CATEGORY_PREFIX}${definition.key}`,
      renderKey: `${SMART_CATEGORY_PREFIX}${definition.key}`,
      name: `${definition.icon} ${definition.name}`,
      icon: definition.icon,
      smartKey: definition.key,
      kind: 'smart' as const,
      section: 'discover' as const,
      count: smartCache.entries[definition.key]?.count ?? getSmartCategoryCountSync(providerId, 'movie', definition.key),
      countKnown:
        smartCache.entries[definition.key] !== undefined ||
        getSmartCategoryCountSync(providerId, 'movie', definition.key) > 0,
    }));

    const providerWithKind: MovieCategory[] = sortedProviderCategories.map((category) => ({
      ...category,
      kind: 'provider' as const,
      section: 'provider' as const,
      count: getCategoryCountFromIndex(providerId, 'movie', category.id) ?? category.count,
      countKnown: getCategoryCountFromIndex(providerId, 'movie', category.id) !== undefined || category.countKnown !== false,
    }));
    const providerWithFallback = appendFallbackCategory(providerWithKind, providerId);

    return [
      {
        id: SECTION_DISCOVER_ID,
        renderKey: SECTION_DISCOVER_ID,
        name: 'Discover',
        count: 0,
        kind: 'section' as const,
        section: 'discover' as const,
      },
      ...smartCategories,
      {
        id: SECTION_PROVIDER_ID,
        renderKey: SECTION_PROVIDER_ID,
        name: 'From Your Provider',
        count: 0,
        kind: 'section' as const,
        section: 'provider' as const,
      },
      ...providerWithFallback,
    ];
  }

  async function loadAllSmartMovieSummaries(definition: NonNullable<ReturnType<typeof resolveSmartCategoryDefinition>>) {
    const cached = getSmartCategoryEntrySync(providerId, 'movie', definition.key);
    const index = getMovieCatalogIndex(providerId);

    if (cached?.itemIds.length) {
      const cachedSummaries = await resolveSummariesFromCachedIds(cached.itemIds, index, base);
      if (cachedSummaries.length > 0) {
        return cachedSummaries;
      }
    }

    const ctx = await buildLibraryContext(providerId);
    const maxItems = definition.maxItems ?? Math.max(index.size, cached?.itemIds.length ?? 0);
    const result = querySmartCategoryOnIndex(index, definition, ctx, 0, maxItems) as {
      filtered: MovieCatalogEntry[];
      items: MovieCatalogEntry[];
      totalCount: number;
    };
    logSmartCategoryCatalogAudit({
      providerId,
      mediaType: 'movie',
      categoryKey: definition.key,
      candidateTotal: result.totalCount,
      catalogCompleteness: index.getCompleteness(),
    });

    if (result.filtered.length > 0) {
      return result.filtered.map(entryToSummary);
    }

    if (cached?.itemIds.length) {
      return resolveSummariesFromCachedIds(cached.itemIds, index, base);
    }

    return [];
  }

  async function querySmartMovies(
    categoryId: string,
    offset: number,
    limit: number,
    sort: ContentSortOption = DEFAULT_CONTENT_SORT,
  ) {
    const definition = resolveSmartCategoryDefinition(categoryId);
    if (!definition) {
      return { items: [], totalCount: 0, hasMore: false, sortComplete: true, hasValidRatings: false };
    }

    const allItems = await loadAllSmartMovieSummaries(definition);
    const sorted = sortContentItems(partitionMediaSummariesUsFirst(allItems), sort, 'movie') as MovieSummary[];
    const page = paginateSortedItems(sorted, offset, limit);
    return {
      ...page,
      ...buildContentSortPageMetadata(allItems.length, sorted.length, categoryHasValidRatings(allItems)),
    };
  }

  return {
    async getCategories() {
      const providerCategories = await base.getCategories();
      return buildSmartCategories(providerCategories);
    },

    async getMoviesPage(input) {
      if (isSectionCategoryId(input.categoryId)) {
        return { items: [], totalCount: 0, hasMore: false };
      }

      if (isSmartCategoryId(input.categoryId)) {
        return querySmartMovies(input.categoryId, input.offset, input.limit, input.sort ?? DEFAULT_CONTENT_SORT);
      }

      return base.getMoviesPage(input);
    },

    async searchMovies(input) {
      const indexed = getMovieCatalogIndex(providerId);
      if (indexed.size > 0) {
        const page = await searchMoviesRepository(providerId, null, {
          providerId,
          query: input.query,
          offset: input.offset,
          limit: input.limit,
        });
        return {
          items: page.items.map((result) => indexed.getEntry(result.id)).filter(Boolean).map((entry) => entryToSummary(entry!)),
          totalCount: page.totalCount,
          hasMore: page.hasMore,
        };
      }

      return base.searchMovies(input);
    },

    getMovieInfo: base.getMovieInfo
      ? (movieId: string) => base.getMovieInfo!(movieId)
      : undefined,

    async getCategoryCount(categoryId) {
      if (isSectionCategoryId(categoryId)) {
        return 0;
      }

      if (isSmartCategoryId(categoryId)) {
        const definition = resolveSmartCategoryDefinition(categoryId);
        if (!definition) {
          return 0;
        }

        const count = getSmartCategoryCountSync(providerId, 'movie', definition.key);
        return definition.maxItems ? Math.min(count, definition.maxItems) : count;
      }

      return getCategoryCountFromIndex(providerId, 'movie', categoryId) ?? base.getCategoryCount?.(categoryId) ?? 0;
    },

    async prefetchAllCategoryCounts(categoryIds, onCategoryCount) {
      const providerIds = categoryIds.filter(isProviderCategoryId);
      if (!base.prefetchAllCategoryCounts) {
        return;
      }

      await base.prefetchAllCategoryCounts(providerIds, onCategoryCount);
    },

    async listCategoryMovies(categoryId) {
      if (!base.listCategoryMovies) {
        if (isProviderCategoryId(categoryId)) {
          const loaded = await loadAllMoviesForCatalogIndex(base, categoryId);
          return loaded.items;
        }
        return [];
      }

      return base.listCategoryMovies(categoryId);
    },
  };
}

export async function refreshSmartCategoryCounts(
  providerId: string,
  categories: MovieCategory[],
): Promise<MovieCategory[]> {
  const settings = await getMoviesSettings();
  if (settings.hideSmartCategories) {
    return categories;
  }

  const smartCache = getSmartCategoryCacheSync(providerId, 'movie');

  return categories.map((category) => {
    if (category.kind !== 'smart' || !category.smartKey) {
      if (category.kind === 'provider') {
        return {
          ...category,
          count: getCategoryCountFromIndex(providerId, 'movie', category.id) ?? category.count,
          countKnown: getCategoryCountFromIndex(providerId, 'movie', category.id) !== undefined || category.countKnown !== false,
        };
      }
      return category;
    }

    return {
      ...category,
      count: smartCache.entries[category.smartKey]?.count ?? category.count,
      countKnown:
        smartCache.entries[category.smartKey] !== undefined ||
        category.countKnown !== false ||
        category.count > 0,
    };
  });
}

export function filterProviderCategoryIds(categories: MovieCategory[]) {
  return categories.filter((category) => category.kind === 'provider' || isProviderCategoryId(category.id)).map((category) => category.id);
}

export function findDefaultCategoryId(categories: MovieCategory[]) {
  return findDefaultBrowseCategoryId(categories);
}
