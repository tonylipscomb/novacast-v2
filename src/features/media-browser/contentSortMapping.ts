import type { CatalogItemSort } from '../catalog/catalogTypes.ts';
import { DEFAULT_CONTENT_SORT, type ContentSortOption } from './contentSorting.ts';

export function mapContentSortToCatalogSort(sort: ContentSortOption | undefined): CatalogItemSort {
  switch (sort) {
    case 'oldest':
      return 'oldest';
    case 'title-desc':
      return 'title-desc';
    case 'title-asc':
      return 'title';
    case 'rating-desc':
      return 'rating';
    case 'popularity-desc':
      return 'popularity';
    case 'recently-added':
      return 'recently-added';
    case 'newest':
    default:
      return 'newest';
  }
}

export function contentSortOptionContracts(): Record<ContentSortOption, CatalogItemSort> {
  return {
    newest: mapContentSortToCatalogSort('newest'),
    oldest: mapContentSortToCatalogSort('oldest'),
    'title-asc': mapContentSortToCatalogSort('title-asc'),
    'title-desc': mapContentSortToCatalogSort('title-desc'),
    'rating-desc': mapContentSortToCatalogSort('rating-desc'),
    'popularity-desc': mapContentSortToCatalogSort('popularity-desc'),
    'recently-added': mapContentSortToCatalogSort('recently-added'),
  };
}

export function defaultContentSortOption(): ContentSortOption {
  return DEFAULT_CONTENT_SORT;
}
