import type { SeriesCatalogEntry } from './seriesCatalogIndex.ts';
import { compareContentItems } from '../../media-browser/contentSorting.ts';
import {
  collectSeriesCatalogEntries,
  curateSeriesNewReleases,
  paginateCuratedEntries,
  resolveSmartCategoryKey,
  SERIES_NEW_RELEASES_LIMIT,
  SMART_CATEGORY_KEY_FEATURES,
  SMART_CATEGORY_KEY_NEW_RELEASES,
} from '../../media-browser/newReleasesCuration.ts';

export type SmartSeriesCategoryContext = {
  providerId: string;
  favorites: Set<string>;
  watchlist: Set<string>;
  continueWatching: string[];
  recentlyWatched: string[];
};

export type SmartSeriesCategoryDefinition = {
  key: string;
  name: string;
  icon: string;
  requiresLibrary?: boolean;
  maxItems?: number;
  predicate: (entry: SeriesCatalogEntry, ctx: SmartSeriesCategoryContext) => boolean;
  sort: (left: SeriesCatalogEntry, right: SeriesCatalogEntry) => number;
  idOrder?: (ctx: SmartSeriesCategoryContext) => string[];
};

function querySeriesNewReleasesOnIndex(
  index: {
    forEachEntry(callback: (entry: SeriesCatalogEntry) => void): void;
  },
  offset: number,
  limit: number,
) {
  const curated = curateSeriesNewReleases(collectSeriesCatalogEntries(index));
  const page = paginateCuratedEntries(curated, offset, limit);
  return {
    items: page.items,
    totalCount: page.totalCount,
    hasMore: page.hasMore,
  };
}

function querySeriesNewReleasesFromEntries(entries: SeriesCatalogEntry[], offset: number, limit: number) {
  const curated = curateSeriesNewReleases(entries);
  const page = paginateCuratedEntries(curated, offset, limit);
  return {
    items: page.items,
    totalCount: page.totalCount,
    hasMore: page.hasMore,
  };
}

function byRatingDesc(left: SeriesCatalogEntry, right: SeriesCatalogEntry) {
  return right.rating - left.rating || (right.year ?? 0) - (left.year ?? 0);
}

function byPopularityDesc(left: SeriesCatalogEntry, right: SeriesCatalogEntry) {
  const leftPopularity = left.popularity ?? 0;
  const rightPopularity = right.popularity ?? 0;
  if (leftPopularity !== rightPopularity) {
    return rightPopularity - leftPopularity;
  }
  return byRatingDesc(left, right);
}

function byNewest(left: SeriesCatalogEntry, right: SeriesCatalogEntry) {
  return compareContentItems(left, right, 'newest', 'series');
}

function orderByIds(ids: string[]) {
  const rank = new Map(ids.map((id, index) => [id, index]));
  return (left: SeriesCatalogEntry, right: SeriesCatalogEntry) =>
    (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER);
}

const ALL_DEFINITIONS: SmartSeriesCategoryDefinition[] = [
  {
    key: 'continue-watching',
    name: 'Continue Watching',
    icon: '▶️',
    requiresLibrary: true,
    maxItems: 15,
    predicate: (entry, ctx) => ctx.continueWatching.includes(entry.id),
    sort: byRatingDesc,
    idOrder: (ctx) => ctx.continueWatching.slice(0, 15),
  },
  {
    key: 'recently-watched',
    name: 'Recently Watched',
    icon: '🕘',
    requiresLibrary: true,
    maxItems: 10,
    predicate: (entry, ctx) => ctx.recentlyWatched.includes(entry.id),
    sort: byRatingDesc,
    idOrder: (ctx) => ctx.recentlyWatched.slice(0, 10),
  },
  {
    key: 'favorites',
    name: 'Favorites',
    icon: '❤️',
    requiresLibrary: true,
    maxItems: 20,
    predicate: (entry, ctx) => ctx.favorites.has(entry.id),
    sort: byRatingDesc,
  },
  {
    key: SMART_CATEGORY_KEY_FEATURES,
    name: 'Features',
    icon: '⭐',
    maxItems: SERIES_NEW_RELEASES_LIMIT,
    predicate: () => true,
    sort: byPopularityDesc,
  },
  {
    key: SMART_CATEGORY_KEY_NEW_RELEASES,
    name: 'New Releases',
    icon: '✨',
    maxItems: SERIES_NEW_RELEASES_LIMIT,
    predicate: () => true,
    sort: byNewest,
  },
];

export function getActiveSmartSeriesCategoryDefinitions() {
  return ALL_DEFINITIONS;
}

export function resolveSmartSeriesCategoryDefinition(key: string) {
  const resolvedKey = resolveSmartCategoryKey(key);
  return ALL_DEFINITIONS.find((definition) => definition.key === resolvedKey) ?? null;
}

export function buildSmartSeriesCategoryContext(input: {
  providerId: string;
  favorites: string[];
  watchlist: string[];
  continueWatching: string[];
  recentlyWatched: string[];
}): SmartSeriesCategoryContext {
  return {
    providerId: input.providerId,
    favorites: new Set(input.favorites.slice(0, 20)),
    watchlist: new Set(input.watchlist),
    continueWatching: input.continueWatching.slice(0, 15),
    recentlyWatched: input.recentlyWatched.slice(0, 10),
  };
}

export function countSmartSeriesCategory(
  entries: SeriesCatalogEntry[],
  definition: SmartSeriesCategoryDefinition,
  ctx: SmartSeriesCategoryContext,
) {
  if (definition.key === SMART_CATEGORY_KEY_NEW_RELEASES) {
    return curateSeriesNewReleases(entries).length;
  }

  if (definition.idOrder) {
    const ids = definition.idOrder(ctx);
    return ids.filter((id) => entries.some((entry) => entry.id === id && definition.predicate(entry, ctx))).length;
  }

  let total = 0;
  const source = entries;
  for (const entry of source) {
    if (definition.predicate(entry, ctx)) {
      total += 1;
      if (definition.maxItems && total >= definition.maxItems) {
        break;
      }
    }
  }
  return definition.maxItems ? Math.min(total, definition.maxItems) : total;
}

export function querySmartSeriesCategoryOnIndex(
  index: {
    forEachEntry(callback: (entry: SeriesCatalogEntry) => void): void;
  },
  definition: SmartSeriesCategoryDefinition,
  ctx: SmartSeriesCategoryContext,
  offset: number,
  limit: number,
) {
  if (definition.key === SMART_CATEGORY_KEY_NEW_RELEASES) {
    return querySeriesNewReleasesOnIndex(index, offset, limit);
  }

  if (definition.idOrder) {
    const orderedIds = definition.idOrder(ctx);
    const rank = new Map(orderedIds.map((id, index) => [id, index]));
    const filtered: SeriesCatalogEntry[] = [];
    index.forEachEntry((entry) => {
      if (definition.predicate(entry, ctx) && rank.has(entry.id)) {
        filtered.push(entry);
      }
    });
    filtered.sort(
      (left, right) =>
        (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER),
    );
    const capped = definition.maxItems ? filtered.slice(0, definition.maxItems) : filtered;
    const items = capped.slice(offset, offset + limit);
    return {
      items,
      totalCount: capped.length,
      hasMore: offset + limit < capped.length,
    };
  }

  const sort = definition.sort;
  const filtered: SeriesCatalogEntry[] = [];
  index.forEachEntry((entry) => {
    if (definition.predicate(entry, ctx)) {
      filtered.push(entry);
    }
  });
  filtered.sort(sort);
  const capped = definition.maxItems ? filtered.slice(0, definition.maxItems) : filtered;
  const items = capped.slice(offset, offset + limit);
  return {
    items,
    totalCount: capped.length,
    hasMore: offset + limit < capped.length,
  };
}

export function querySmartSeriesCategory(
  entries: SeriesCatalogEntry[],
  definition: SmartSeriesCategoryDefinition,
  ctx: SmartSeriesCategoryContext,
  offset: number,
  limit: number,
  index?: {
    forEachEntry(callback: (entry: SeriesCatalogEntry) => void): void;
  },
) {
  if (definition.key === SMART_CATEGORY_KEY_NEW_RELEASES) {
    if (index) {
      return querySeriesNewReleasesOnIndex(index, offset, limit);
    }
    return querySeriesNewReleasesFromEntries(entries, offset, limit);
  }

  const sort = definition.idOrder ? orderByIds(definition.idOrder(ctx)) : definition.sort;

  let filtered: SeriesCatalogEntry[] = [];
  if (index) {
    index.forEachEntry((entry) => {
      if (definition.predicate(entry, ctx)) {
        filtered.push(entry);
      }
    });
    filtered.sort(sort);
  } else {
    filtered = entries.filter((entry) => definition.predicate(entry, ctx)).sort(sort);
  }

  if (definition.maxItems) {
    filtered = filtered.slice(0, definition.maxItems);
  }

  const items = filtered.slice(offset, offset + limit);
  return {
    items,
    totalCount: filtered.length,
    hasMore: offset + limit < filtered.length,
  };
}
