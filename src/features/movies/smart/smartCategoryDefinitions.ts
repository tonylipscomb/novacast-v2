import type { MovieCatalogEntry } from './movieCatalogIndex.ts';
import { compareContentItems } from '../../media-browser/contentSorting.ts';
import {
  collectMovieCatalogEntries,
  curateMovieNewReleases,
  MOVIE_NEW_RELEASES_LIMIT,
  paginateCuratedEntries,
  resolveSmartCategoryKey,
  SMART_CATEGORY_KEY_FEATURES,
  SMART_CATEGORY_KEY_NEW_RELEASES,
} from '../../media-browser/newReleasesCuration.ts';

export type SmartCategoryContext = {
  providerId: string;
  favorites: Set<string>;
  watchlist: Set<string>;
  continueWatching: string[];
  recentlyWatched: string[];
  lastWatchedGenres: string[];
};

export type SmartCategoryDefinition = {
  key: string;
  name: string;
  icon: string;
  requiresLibrary?: boolean;
  maxItems?: number;
  predicate: (entry: MovieCatalogEntry, ctx: SmartCategoryContext) => boolean;
  sort: (left: MovieCatalogEntry, right: MovieCatalogEntry) => number;
  idOrder?: (ctx: SmartCategoryContext) => string[];
};

function queryMovieNewReleasesOnIndex(
  index: {
    forEachEntry(callback: (entry: MovieCatalogEntry) => void): void;
  },
  offset: number,
  limit: number,
) {
  const curated = curateMovieNewReleases(collectMovieCatalogEntries(index));
  const page = paginateCuratedEntries(curated, offset, limit);
  return {
    filtered: curated,
    items: page.items,
    totalCount: page.totalCount,
    hasMore: page.hasMore,
  };
}

function queryMovieNewReleasesFromEntries(entries: MovieCatalogEntry[], offset: number, limit: number) {
  const curated = curateMovieNewReleases(entries);
  const page = paginateCuratedEntries(curated, offset, limit);
  return {
    filtered: curated,
    items: page.items,
    totalCount: page.totalCount,
    hasMore: page.hasMore,
  };
}

function byRatingDesc(left: MovieCatalogEntry, right: MovieCatalogEntry) {
  return right.rating - left.rating || right.added - left.added;
}

function byPopularityDesc(left: MovieCatalogEntry, right: MovieCatalogEntry) {
  const leftPopularity = left.popularity ?? 0;
  const rightPopularity = right.popularity ?? 0;
  if (leftPopularity !== rightPopularity) {
    return rightPopularity - leftPopularity;
  }
  return byRatingDesc(left, right);
}

function byNewest(left: MovieCatalogEntry, right: MovieCatalogEntry) {
  return compareContentItems(
    { ...left, addedAt: left.added },
    { ...right, addedAt: right.added },
    'newest',
    'movie',
  );
}

function orderByIds(ids: string[]) {
  const rank = new Map(ids.map((id, index) => [id, index]));
  return (left: MovieCatalogEntry, right: MovieCatalogEntry) =>
    (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER);
}

export const SMART_CATEGORY_DEFINITIONS: SmartCategoryDefinition[] = [
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
    icon: '🕐',
    requiresLibrary: true,
    maxItems: 10,
    predicate: (entry, ctx) => ctx.recentlyWatched.includes(entry.id),
    sort: byRatingDesc,
    idOrder: (ctx) => ctx.recentlyWatched.slice(0, 10),
  },
  {
    key: 'your-favorites',
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
    maxItems: MOVIE_NEW_RELEASES_LIMIT,
    predicate: () => true,
    sort: byPopularityDesc,
  },
  {
    key: SMART_CATEGORY_KEY_NEW_RELEASES,
    name: 'New Releases',
    icon: '🆕',
    maxItems: MOVIE_NEW_RELEASES_LIMIT,
    predicate: () => true,
    sort: byNewest,
  },
];

export function getActiveSmartCategoryDefinitions() {
  return SMART_CATEGORY_DEFINITIONS;
}

export function resolveSmartCategoryDefinition(categoryId: string) {
  const key = categoryId.startsWith('smart:') ? categoryId.slice('smart:'.length) : categoryId;
  const resolvedKey = resolveSmartCategoryKey(key);
  return SMART_CATEGORY_DEFINITIONS.find((definition) => definition.key === resolvedKey) ?? null;
}

export function buildSmartCategoryContext(input: {
  providerId: string;
  favorites: string[];
  watchlist: string[];
  continueWatching: string[];
  recentlyWatched: string[];
  lastWatchedGenres: string[];
}): SmartCategoryContext {
  return {
    providerId: input.providerId,
    favorites: new Set(input.favorites.slice(0, 20)),
    watchlist: new Set(input.watchlist),
    continueWatching: input.continueWatching.slice(0, 15),
    recentlyWatched: input.recentlyWatched.slice(0, 10),
    lastWatchedGenres: input.lastWatchedGenres,
  };
}

export function querySmartCategoryOnIndex(
  index: {
    forEachEntry(callback: (entry: MovieCatalogEntry) => void): void;
    getEntry(id: string): MovieCatalogEntry | undefined;
  },
  definition: SmartCategoryDefinition,
  ctx: SmartCategoryContext,
  offset: number,
  limit: number,
) {
  if (definition.key === SMART_CATEGORY_KEY_NEW_RELEASES) {
    return queryMovieNewReleasesOnIndex(index, offset, limit);
  }

  if (definition.idOrder) {
    const orderedIds = definition.idOrder(ctx);
    const rank = new Map(orderedIds.map((id, index) => [id, index]));
    const filtered: MovieCatalogEntry[] = [];
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
      filtered: capped,
      items,
      totalCount: capped.length,
      hasMore: offset + limit < capped.length,
    };
  }

  return querySmartCategory([], definition, ctx, offset, limit, index);
}

export function querySmartCategory(
  entries: MovieCatalogEntry[],
  definition: SmartCategoryDefinition,
  ctx: SmartCategoryContext,
  offset: number,
  limit: number,
  index?: {
    forEachEntry(callback: (entry: MovieCatalogEntry) => void): void;
  },
) {
  if (definition.key === SMART_CATEGORY_KEY_NEW_RELEASES) {
    if (index) {
      return queryMovieNewReleasesOnIndex(index, offset, limit);
    }
    return queryMovieNewReleasesFromEntries(entries, offset, limit);
  }

  const sortFn = definition.idOrder ? orderByIds(definition.idOrder(ctx)) : definition.sort;

  let filtered: MovieCatalogEntry[] = [];
  if (index) {
    index.forEachEntry((entry) => {
      if (definition.predicate(entry, ctx)) {
        filtered.push(entry);
      }
    });
    filtered.sort(sortFn);
  } else {
    filtered = entries.filter((entry) => definition.predicate(entry, ctx)).sort(sortFn);
  }

  if (definition.maxItems) {
    filtered = filtered.slice(0, definition.maxItems);
  }

  const items = filtered.slice(offset, offset + limit);
  return {
    filtered,
    items,
    totalCount: filtered.length,
    hasMore: offset + limit < filtered.length,
  };
}

export function countSmartCategory(
  entries: MovieCatalogEntry[],
  definition: SmartCategoryDefinition,
  ctx: SmartCategoryContext,
) {
  if (definition.key === SMART_CATEGORY_KEY_NEW_RELEASES) {
    return curateMovieNewReleases(entries).length;
  }

  if (definition.idOrder) {
    const ids = definition.idOrder(ctx);
    return ids.filter((id) => entries.some((entry) => entry.id === id && definition.predicate(entry, ctx))).length;
  }

  let total = 0;
  for (const entry of entries) {
    if (definition.predicate(entry, ctx)) {
      total += 1;
      if (definition.maxItems && total >= definition.maxItems) {
        break;
      }
    }
  }
  return definition.maxItems ? Math.min(total, definition.maxItems) : total;
}
