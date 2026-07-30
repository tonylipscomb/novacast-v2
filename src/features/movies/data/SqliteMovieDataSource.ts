import {
  getCatalogCategoryCounts,
  getCatalogItemsPage,
  getCatalogSyncState,
  getCatalogTotalCount,
} from '../../catalog/catalogRepository.ts';
import type { CatalogItemRecord, CatalogItemSort } from '../../catalog/catalogTypes.ts';
import type { ContentSortOption } from '../../media-browser/contentSorting.ts';

import type { MovieDataSource } from './MovieDataSource.ts';
import type { MovieCategory, MovieSummary } from '../movieTypes.ts';

const SQLITE_MOVIES_DISCOVER_ID = 'all';

function mapSort(sort: ContentSortOption | undefined): CatalogItemSort {
  switch (sort) {
    case 'oldest':
      return 'oldest';
    case 'title-desc':
      return 'title-desc';
    case 'rating-desc':
      return 'rating';
    case 'popularity-desc':
    case 'recently-added':
      // SQLite schema does not yet retain popularity or provider-added timestamps.
      // Preserve deterministic provider ordering until those fields are added.
      return 'provider';
    case 'title-asc':
      return 'title';
    case 'newest':
    default:
      return 'newest';
  }
}

function mapCatalogItemToMovie(item: CatalogItemRecord): MovieSummary {
  return {
    id: item.contentId,
    categoryId: item.categoryId ?? '',
    title: item.title,
    year: item.releaseYear ?? undefined,
    releaseDate: item.releaseDate ?? undefined,
    rating: item.rating == null ? undefined : String(item.rating),
    genres: ['Movies'],
    description: item.description ?? undefined,
    score: item.rating ?? undefined,
    posterStyleKey: 'ember',
    posterUrl: item.artworkUrl ?? undefined,
    containerExtension: item.streamExtension ?? undefined,
    providerSortOrder: item.providerSortOrder ?? undefined,
  };
}

export async function isSqliteMovieCatalogReady(providerId: string): Promise<boolean> {
  const state = await getCatalogSyncState(providerId, 'movie');
  return state?.status === 'ready' && state.generation > 0;
}

export function createSqliteMovieDataSource(providerId: string): MovieDataSource {
  return {
    sourceKind: 'sqlite',

    async getCategories(): Promise<MovieCategory[]> {
      const [categories, totalCount] = await Promise.all([
        getCatalogCategoryCounts(providerId, 'movie'),
        getCatalogTotalCount(providerId, 'movie'),
      ]);

      if (!categories.length && totalCount <= 0) {
        console.info('[Movies SQLite] unavailable', { providerId });
        return [];
      }

      console.info('[Movies SQLite] category-counts', {
        providerId,
        categoryCount: categories.length,
        totalCount,
      });

      return [
        {
          id: SQLITE_MOVIES_DISCOVER_ID,
          renderKey: SQLITE_MOVIES_DISCOVER_ID,
          name: 'All Movies',
          count: totalCount,
          countKnown: true,
          kind: 'provider',
          section: 'provider',
        },
        ...categories.map((category) => ({
          id: category.categoryId,
          renderKey: category.categoryId,
          name: category.categoryName,
          rawName: category.categoryName,
          count: category.itemCount,
          countKnown: true,
          kind: 'provider' as const,
          section: 'provider' as const,
        })),
      ];
    },

    async getMoviesPage(input) {
      const categoryId =
        input.categoryId && input.categoryId !== SQLITE_MOVIES_DISCOVER_ID
          ? input.categoryId
          : undefined;

      const page = await getCatalogItemsPage({
        providerId,
        mediaType: 'movie',
        categoryId,
        offset: input.offset,
        limit: input.limit,
        sort: mapSort(input.sort),
      });

      console.info('[Movies SQLite] first-page', {
        providerId,
        categoryId: categoryId ?? SQLITE_MOVIES_DISCOVER_ID,
        offset: page.offset,
        itemCount: page.items.length,
        totalCount: page.totalCount,
      });

      return {
        items: page.items.map(mapCatalogItemToMovie),
        totalCount: page.totalCount,
        hasMore: page.hasMore,
      };
    },

    async searchMovies(input) {
      const page = await getCatalogItemsPage({
        providerId,
        mediaType: 'movie',
        query: input.query,
        offset: input.offset,
        limit: input.limit,
        sort: 'title',
      });

      console.info('[Movies SQLite] search', {
        providerId,
        queryLength: input.query.trim().length,
        offset: page.offset,
        itemCount: page.items.length,
        totalCount: page.totalCount,
      });

      return {
        items: page.items.map(mapCatalogItemToMovie),
        totalCount: page.totalCount,
        hasMore: page.hasMore,
      };
    },

    async getCategoryCount(categoryId) {
      if (!categoryId || categoryId === SQLITE_MOVIES_DISCOVER_ID) {
        return getCatalogTotalCount(providerId, 'movie');
      }

      const categories = await getCatalogCategoryCounts(providerId, 'movie');
      return categories.find((category) => category.categoryId === categoryId)?.itemCount ?? 0;
    },

    async prefetchAllCategoryCounts(categoryIds, onCategoryCount) {
      const [categories, totalCount] = await Promise.all([
        getCatalogCategoryCounts(providerId, 'movie'),
        getCatalogTotalCount(providerId, 'movie'),
      ]);
      const byId = new Map(categories.map((category) => [category.categoryId, category.itemCount]));

      for (const categoryId of categoryIds) {
        onCategoryCount(
          categoryId,
          categoryId === SQLITE_MOVIES_DISCOVER_ID ? totalCount : byId.get(categoryId) ?? 0,
        );
      }
    },
  };
}