import type { ProviderCategoryContentType } from './categoryNormalization.ts';
import {
  categoryRegionalSortRank,
  isUsAmericanLiveLabel,
  sortProviderCategoriesByRegion,
  type CategorySortLabel,
} from './categoryRegionalPipeline.ts';
import { filterContentByPolicy } from '../content-policy/ContentPolicyService.ts';

export { isUsAmericanLiveLabel } from './categoryRegionalPipeline.ts';

export type UsAmericanSortLabel = CategorySortLabel;

/** Maps the regional pipeline priority into legacy 0/1/2 tiers for callers that still expect it. */
export function providerRegionalSortRank(
  item: UsAmericanSortLabel,
  options?: { allowTitleParse?: boolean; contentType?: ProviderCategoryContentType },
): number {
  const priority = categoryRegionalSortRank(item, options?.contentType);
  if (priority <= 3) {
    return 0;
  }

  if (priority >= 7) {
    return 2;
  }

  return 1;
}

export function usAmericanLiveRank(
  item: UsAmericanSortLabel,
  options?: { allowTitleParse?: boolean; contentType?: ProviderCategoryContentType },
): number {
  return providerRegionalSortRank(item, options) === 0 ? 0 : 1;
}

function withContentPolicy<T extends UsAmericanSortLabel>(
  items: T[],
  contentType?: ProviderCategoryContentType,
): T[] {
  return filterContentByPolicy(items, contentType);
}

/** Stable sort: smart region priority, then alphabetical within each group. */
export function sortByRegionalPreference<T extends UsAmericanSortLabel>(
  items: T[],
  options?: {
    allowTitleParse?: boolean;
    contentType?: ProviderCategoryContentType;
    alphabetizeWithinGroup?: boolean;
  },
): T[] {
  return sortProviderCategoriesByRegion(withContentPolicy(items, options?.contentType), {
    contentType: options?.contentType,
    alphabetizeWithinGroup: options?.alphabetizeWithinGroup,
  });
}

/** Stable partition: preferred regions first, preserving provider order within ties. */
export function partitionLiveItemsUsFirst<T extends UsAmericanSortLabel>(
  items: T[],
  options?: { allowTitleParse?: boolean; contentType?: ProviderCategoryContentType },
): T[] {
  return sortProviderCategoriesByRegion(withContentPolicy(items, options?.contentType ?? 'live'), {
    contentType: options?.contentType ?? 'live',
    alphabetizeWithinGroup: false,
  });
}

/** @deprecated Prefer sortByRegionalPreference for large live catalogs. */
export function sortLiveItemsUsFirst<T extends UsAmericanSortLabel>(
  items: T[],
  options?: { allowTitleParse?: boolean; contentType?: ProviderCategoryContentType },
): T[] {
  return sortProviderCategoriesByRegion(withContentPolicy(items, options?.contentType ?? 'live'), {
    contentType: options?.contentType ?? 'live',
    alphabetizeWithinGroup: true,
  });
}

/** Sort mapped media summaries with regional preference and alphabetical grouping. */
export function partitionMediaSummariesUsFirst<T extends { title: string; countryCode?: string; rawTitle?: string }>(
  items: T[],
): T[] {
  const wrapped = items.map((item) => ({
    item,
    name: item.title,
    rawName: item.rawTitle,
    countryCode: item.countryCode,
  }));

  return sortProviderCategoriesByRegion(withContentPolicy(wrapped), { alphabetizeWithinGroup: true }).map(
    ({ item }) => item,
  );
}

export const sortLiveCategoriesUsFirst = sortLiveItemsUsFirst;

export function sortLiveChannelsUsFirst<T extends UsAmericanSortLabel>(items: T[]): T[] {
  return sortProviderCategoriesByRegion(withContentPolicy(items, 'live'), {
    contentType: 'live',
    alphabetizeWithinGroup: false,
  });
}

export function sortMediaCategoriesUsFirst<T extends UsAmericanSortLabel>(items: T[]): T[] {
  return sortProviderCategoriesByRegion(withContentPolicy(items, 'movie'), {
    contentType: 'movie',
    alphabetizeWithinGroup: true,
  });
}

export function sortProviderCategoriesUsFirst<T extends UsAmericanSortLabel>(
  items: T[],
  contentType: ProviderCategoryContentType = 'movie',
): T[] {
  return sortProviderCategoriesByRegion(withContentPolicy(items, contentType), {
    contentType,
    alphabetizeWithinGroup: true,
  });
}
