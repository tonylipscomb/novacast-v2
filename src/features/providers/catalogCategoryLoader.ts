import type { MovieDataSource } from '../movies/data/MovieDataSource.ts';
import type { MovieSummary } from '../movies/movieTypes.ts';
import type { SeriesDataSource } from '../series/data/SeriesDataSource.ts';
import type { SeriesSummary } from '../media-browser/mediaTypes.ts';
import { MAX_CATALOG_INDEX_ITEMS } from './catalogCompleteness.ts';

export type CategoryLoadResult<T> = {
  items: T[];
  truncated: boolean;
};

const CATALOG_PAGE_SIZE = 1_000;

export async function loadAllMoviesForCatalogIndex(
  movies: MovieDataSource,
  categoryId: string,
): Promise<CategoryLoadResult<MovieSummary>> {
  if (movies.listCategoryMovies) {
    const items = await movies.listCategoryMovies(categoryId);
    if (items.length > MAX_CATALOG_INDEX_ITEMS) {
      return { items: items.slice(0, MAX_CATALOG_INDEX_ITEMS), truncated: true };
    }
    return { items, truncated: false };
  }

  const collected: MovieSummary[] = [];
  let offset = 0;

  while (collected.length < MAX_CATALOG_INDEX_ITEMS) {
    const page = await movies.getMoviesPage({ categoryId, offset, limit: CATALOG_PAGE_SIZE });
    collected.push(...page.items);
    if (!page.hasMore || page.items.length === 0) {
      return { items: collected, truncated: false };
    }
    offset += page.items.length;
    if (collected.length >= MAX_CATALOG_INDEX_ITEMS) {
      return { items: collected.slice(0, MAX_CATALOG_INDEX_ITEMS), truncated: true };
    }
  }

  return { items: collected.slice(0, MAX_CATALOG_INDEX_ITEMS), truncated: true };
}

export async function loadAllSeriesForCatalogIndex(
  series: SeriesDataSource,
  categoryId: string,
): Promise<CategoryLoadResult<SeriesSummary>> {
  if (series.listCategorySeries) {
    const items = await series.listCategorySeries(categoryId);
    if (items.length > MAX_CATALOG_INDEX_ITEMS) {
      return { items: items.slice(0, MAX_CATALOG_INDEX_ITEMS), truncated: true };
    }
    return { items, truncated: false };
  }

  const collected: SeriesSummary[] = [];
  let offset = 0;

  while (collected.length < MAX_CATALOG_INDEX_ITEMS) {
    const page = await series.getSeriesPage({ categoryId, offset, limit: CATALOG_PAGE_SIZE });
    collected.push(...page.items);
    if (!page.hasMore || page.items.length === 0) {
      return { items: collected, truncated: false };
    }
    offset += page.items.length;
    if (collected.length >= MAX_CATALOG_INDEX_ITEMS) {
      return { items: collected.slice(0, MAX_CATALOG_INDEX_ITEMS), truncated: true };
    }
  }

  return { items: collected.slice(0, MAX_CATALOG_INDEX_ITEMS), truncated: true };
}
