import type { SeriesDataSource } from '../data/SeriesDataSource.ts';
import { MEDIA_SMART_CATEGORY_PREFIX, type MediaCategory, type SeriesDetail, type SeriesSummary } from '../../media-browser/mediaTypes.ts';
import {
  buildContentSortPageMetadata,
  categoryHasValidRatings,
  DEFAULT_CONTENT_SORT,
  paginateSortedItems,
  sortContentItems,
  type ContentSortOption,
} from '../../media-browser/contentSorting.ts';
import { getMediaSettings } from '../../media-browser/mediaSettingsStore.ts';
import {
  getContinueWatchingEntries,
  getFavoriteIds,
  getRecentlyWatchedIds,
  getWatchlistIds,
} from '../../media-browser/mediaLibraryStore.ts';
import { getCategoryCountFromIndex } from '../../providers/categoryCountIndexStore.ts';
import { fallbackProviderCategoryId } from '../../providers/categoryNormalization.ts';
import { sortProviderCategoriesUsFirst, partitionMediaSummariesUsFirst } from '../../providers/usAmericanSort.ts';
import {
  getSmartCategoryCacheSync,
  getSmartCategoryCountSync,
  getSmartCategoryEntrySync,
} from '../../providers/smartCategoryCacheStore.ts';
import { logSmartCategoryCatalogAudit } from '../../providers/catalogSyncAudit.ts';
import { entryToSeriesSummary, getSeriesCatalogIndex } from './seriesCatalogIndex.ts';
import {
  buildSmartSeriesCategoryContext,
  getActiveSmartSeriesCategoryDefinitions,
  querySmartSeriesCategoryOnIndex,
  resolveSmartSeriesCategoryDefinition,
} from './smartSeriesCategoryDefinitions.ts';
import { searchSeries as searchSeriesRepository } from '../../search/repositories/seriesSearchRepository.ts';
import { findDefaultBrowseCategoryId } from '../../media-browser/mediaCategoryUtils.ts';

export const SECTION_DISCOVER_ID = 'section:discover';
export const SECTION_PROVIDER_ID = 'section:provider';

const indexListeners = new Map<string, Set<() => void>>();

function isSmartCategoryId(categoryId: string) {
  return categoryId.startsWith(MEDIA_SMART_CATEGORY_PREFIX);
}

function isSectionCategoryId(categoryId: string) {
  return categoryId.startsWith('section:');
}

function isProviderCategoryId(categoryId: string) {
  return !isSmartCategoryId(categoryId) && !isSectionCategoryId(categoryId);
}

function detailToSeriesSummary(detail: SeriesDetail, fallbackId?: string): SeriesSummary {
  return {
    id: fallbackId ?? detail.seriesId,
    seriesId: detail.seriesId,
    categoryId: '',
    title: detail.title,
    year: detail.year,
    releaseDate: detail.releaseDate,
    rating: detail.rating,
    genres: detail.genres.length ? detail.genres : ['Series'],
    description: detail.description ?? 'Curated from your NovaCast series library.',
    posterStyleKey: 'ember',
    posterUrl: detail.posterUrl,
    backdropUrl: detail.backdropUrl,
  };
}

async function resolveSummariesFromCachedIds(
  itemIds: string[],
  index: ReturnType<typeof getSeriesCatalogIndex>,
  base: SeriesDataSource,
) {
  const resolved = new Map(index.getSummaries(itemIds).map((summary) => [summary.id, summary]));
  const missing = itemIds.filter((id) => !resolved.has(id));

  if (!missing.length) {
    return itemIds.map((id) => resolved.get(id)).filter((summary): summary is SeriesSummary => Boolean(summary));
  }

  const batchSize = 4;
  for (let offset = 0; offset < missing.length; offset += batchSize) {
    const batch = missing.slice(offset, offset + batchSize);
    const details = await Promise.all(batch.map((id) => base.getSeriesInfo(id).catch(() => null)));
    for (let indexInBatch = 0; indexInBatch < batch.length; indexInBatch += 1) {
      const detail = details[indexInBatch];
      if (!detail) {
        continue;
      }

      const summary = detailToSeriesSummary(detail, batch[indexInBatch]);
      resolved.set(summary.id, summary);
      index.ingest([summary]);
    }
  }

  return itemIds.map((id) => resolved.get(id)).filter((summary): summary is SeriesSummary => Boolean(summary));
}

function notifyIndexListeners(providerId: string) {
  indexListeners.get(providerId)?.forEach((listener) => listener());
}

function appendFallbackCategory(categories: MediaCategory[], providerId: string) {
  const id = fallbackProviderCategoryId('series');
  const count = getCategoryCountFromIndex(providerId, 'series', id);
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

export function subscribeSeriesCatalogIndex(providerId: string, listener: () => void) {
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

export function filterProviderCategoryIds(categories: MediaCategory[]) {
  return categories.filter((category) => isProviderCategoryId(category.id)).map((category) => category.id);
}

export function findDefaultCategoryId(categories: MediaCategory[]) {
  return findDefaultBrowseCategoryId(categories);
}

async function buildLibraryContext(providerId: string) {
  const [favorites, watchlist, continueWatchingEntries, recentlyWatched] = await Promise.all([
    getFavoriteIds(providerId),
    getWatchlistIds(providerId),
    getContinueWatchingEntries(providerId, 'episode'),
    getRecentlyWatchedIds(providerId),
  ]);

  return buildSmartSeriesCategoryContext({
    providerId,
    favorites,
    watchlist,
    continueWatching: continueWatchingEntries.map((entry) => entry.seriesId ?? entry.mediaId),
    recentlyWatched,
  });
}

export async function refreshSmartSeriesCategoryCounts(providerId: string, categories: MediaCategory[]) {
  const smartCache = getSmartCategoryCacheSync(providerId, 'series');

  return categories.map((category) => {
    if (!category.smartKey) {
      if (category.kind === 'provider') {
        return {
          ...category,
          count: getCategoryCountFromIndex(providerId, 'series', category.id) ?? category.count,
          countKnown: getCategoryCountFromIndex(providerId, 'series', category.id) !== undefined || category.countKnown !== false,
        };
      }
      return category;
    }

    return {
      ...category,
      count: smartCache.entries[category.smartKey]?.count ?? category.count,
      countKnown: smartCache.entries[category.smartKey] !== undefined || category.countKnown !== false,
    };
  });
}

export function createSmartSeriesDataSource(base: SeriesDataSource, providerId: string): SeriesDataSource {
  async function buildSmartCategories(providerCategories: MediaCategory[]) {
    const sortedProviderCategories = sortProviderCategoriesUsFirst(providerCategories, 'series');
    const settings = await getMediaSettings();
    if (settings.hideSmartCategories) {
      return appendFallbackCategory(sortedProviderCategories.map((category) => ({
        ...category,
        kind: 'provider' as const,
        section: 'provider' as const,
        count: getCategoryCountFromIndex(providerId, 'series', category.id) ?? category.count,
        countKnown: getCategoryCountFromIndex(providerId, 'series', category.id) !== undefined || category.countKnown !== false,
      })), providerId);
    }

    const definitions = getActiveSmartSeriesCategoryDefinitions();
    const smartCache = getSmartCategoryCacheSync(providerId, 'series');

    const smartCategories: MediaCategory[] = definitions.map((definition) => ({
      id: `${MEDIA_SMART_CATEGORY_PREFIX}${definition.key}`,
      renderKey: `${MEDIA_SMART_CATEGORY_PREFIX}${definition.key}`,
      name: `${definition.icon} ${definition.name}`,
      icon: definition.icon,
      smartKey: definition.key,
      kind: 'smart' as const,
      section: 'discover' as const,
      count: smartCache.entries[definition.key]?.count ?? getSmartCategoryCountSync(providerId, 'series', definition.key),
      countKnown: smartCache.entries[definition.key] !== undefined,
    }));

    const discoverSection: MediaCategory = {
      id: SECTION_DISCOVER_ID,
      renderKey: SECTION_DISCOVER_ID,
      name: 'Discover',
      count: 0,
      kind: 'section',
      section: 'discover',
    };
    const providerSection: MediaCategory = {
      id: SECTION_PROVIDER_ID,
      renderKey: SECTION_PROVIDER_ID,
      name: 'Your Provider',
      count: 0,
      kind: 'section',
      section: 'provider',
    };

    const normalizedProvider = sortedProviderCategories.map((category) => ({
      ...category,
      kind: 'provider' as const,
      section: 'provider' as const,
      count: getCategoryCountFromIndex(providerId, 'series', category.id) ?? category.count,
      countKnown: getCategoryCountFromIndex(providerId, 'series', category.id) !== undefined || category.countKnown !== false,
    }));
    const providerWithFallback = appendFallbackCategory(normalizedProvider, providerId);

    return [discoverSection, ...smartCategories, providerSection, ...providerWithFallback];
  }

  async function loadAllSmartSeriesSummaries(definition: NonNullable<ReturnType<typeof resolveSmartSeriesCategoryDefinition>>) {
    const cached = getSmartCategoryEntrySync(providerId, 'series', definition.key);
    const index = getSeriesCatalogIndex(providerId);

    if (cached?.itemIds.length) {
      const cachedSummaries = await resolveSummariesFromCachedIds(cached.itemIds, index, base);
      if (cachedSummaries.length > 0) {
        return cachedSummaries;
      }
    }

    const ctx = await buildLibraryContext(providerId);
    const maxItems = definition.maxItems ?? Math.max(index.size, cached?.itemIds.length ?? 0);
    const page = querySmartSeriesCategoryOnIndex(index, definition, ctx, 0, maxItems);
    logSmartCategoryCatalogAudit({
      providerId,
      mediaType: 'series',
      categoryKey: definition.key,
      candidateTotal: page.totalCount,
      catalogCompleteness: index.getCompleteness(),
    });

    if (page.items.length > 0) {
      return page.items.map(entryToSeriesSummary);
    }

    if (cached?.itemIds.length) {
      return index.getSummaries(cached.itemIds);
    }

    return [];
  }

  async function querySmartSeriesPage(
    categoryId: string,
    offset: number,
    limit: number,
    sort: ContentSortOption = DEFAULT_CONTENT_SORT,
  ) {
    const smartKey = categoryId.slice(MEDIA_SMART_CATEGORY_PREFIX.length);
    const definition = resolveSmartSeriesCategoryDefinition(smartKey);
    if (!definition) {
      return { items: [], totalCount: 0, hasMore: false, sortComplete: true, hasValidRatings: false };
    }

    const allItems = await loadAllSmartSeriesSummaries(definition);
    const sorted = sortContentItems(partitionMediaSummariesUsFirst(allItems), sort, 'series') as SeriesSummary[];
    const page = paginateSortedItems(sorted, offset, limit);
    return {
      ...page,
      ...buildContentSortPageMetadata(allItems.length, sorted.length, categoryHasValidRatings(allItems)),
    };
  }

  return {
    ...base,
    async getCategories() {
      const providerCategories = await base.getCategories();
      return buildSmartCategories(providerCategories);
    },

    async getSeriesPage({ categoryId, offset, limit, sort = DEFAULT_CONTENT_SORT }) {
      if (isSectionCategoryId(categoryId)) {
        return { items: [], totalCount: 0, hasMore: false, hasValidRatings: false };
      }

      if (!isSmartCategoryId(categoryId)) {
        return base.getSeriesPage({ categoryId, offset, limit, sort });
      }

      return querySmartSeriesPage(categoryId, offset, limit, sort);
    },

    async getCategoryCount(categoryId) {
      if (isSmartCategoryId(categoryId)) {
        const smartKey = categoryId.slice(MEDIA_SMART_CATEGORY_PREFIX.length);
        const definition = resolveSmartSeriesCategoryDefinition(smartKey);
        const count = getSmartCategoryCountSync(providerId, 'series', smartKey);
        return definition?.maxItems ? Math.min(count, definition.maxItems) : count;
      }

      return getCategoryCountFromIndex(providerId, 'series', categoryId) ?? base.getCategoryCount?.(categoryId) ?? 0;
    },

    async searchSeries(input) {
      const indexed = getSeriesCatalogIndex(providerId);
      if (indexed.size > 0) {
        const page = await searchSeriesRepository(providerId, null, {
          providerId,
          query: input.query,
          offset: input.offset,
          limit: input.limit,
        });
        return {
          items: page.items
            .map((result) => indexed.getEntry(result.id))
            .filter(Boolean)
            .map((entry) => entryToSeriesSummary(entry!)),
          totalCount: page.totalCount,
          hasMore: page.hasMore,
        };
      }

      if (base.searchSeries) {
        return base.searchSeries(input);
      }

      return { items: [], totalCount: 0, hasMore: false };
    },
  };
}

export function notifySeriesCatalogReady(providerId: string) {
  notifyIndexListeners(providerId);
}
