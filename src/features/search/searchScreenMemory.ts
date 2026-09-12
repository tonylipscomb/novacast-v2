import type { GroupedSearchResults, SearchResult, SearchScope } from './searchTypes';

export type SearchResultSnapshot = {
  query: string;
  scope: SearchScope;
  results: SearchResult[];
  groupedResults: GroupedSearchResults | null;
  totalCount: number;
  hasMore: boolean;
};

export function canRestoreSearchResultSnapshot(snapshot: SearchResultSnapshot | null | undefined, query: string, scope: SearchScope) {
  return Boolean(snapshot && snapshot.scope === scope && snapshot.query === query);
}

export type SearchScreenMemory = {
  query: string;
  scope: SearchScope;
  focusedResultKey: string | null;
  resultSnapshot: SearchResultSnapshot | null;
};

const DEFAULT_MEMORY: SearchScreenMemory = {
  query: '',
  // search-s2-default-scope
  scope: 'movie',
  focusedResultKey: null,
  resultSnapshot: null,
};

const memoryByProvider = new Map<string, SearchScreenMemory>();

function getDefaultMemory(): SearchScreenMemory {
  return { ...DEFAULT_MEMORY };
}

function getMemoryForProvider(providerId: string) {
  const existing = memoryByProvider.get(providerId);
  if (existing) {
    return existing;
  }

  const next = getDefaultMemory();
  memoryByProvider.set(providerId, next);
  return next;
}

export function getSearchScreenMemory(providerId: string) {
  return getMemoryForProvider(providerId);
}

export function rememberSearchScreenMemory(providerId: string, next: Partial<SearchScreenMemory>) {
  memoryByProvider.set(providerId, {
    ...getMemoryForProvider(providerId),
    ...next,
  });
}

export function rememberSearchResultSnapshot(providerId: string, snapshot: SearchResultSnapshot) {
  const limit = 100;
  const groupedResults = snapshot.groupedResults
    ? {
        live: { ...snapshot.groupedResults.live, items: snapshot.groupedResults.live.items.slice(0, limit) },
        movie: { ...snapshot.groupedResults.movie, items: snapshot.groupedResults.movie.items.slice(0, limit) },
        series: { ...snapshot.groupedResults.series, items: snapshot.groupedResults.series.items.slice(0, limit) },
        guide: { ...snapshot.groupedResults.guide, items: snapshot.groupedResults.guide.items.slice(0, limit) },
      }
    : null;
  rememberSearchScreenMemory(providerId, {
    resultSnapshot: {
      ...snapshot,
      results: snapshot.results.slice(0, limit),
      groupedResults,
    },
  });
}

export function clearSearchResultSnapshot(providerId: string) {
  rememberSearchScreenMemory(providerId, { resultSnapshot: null });
}

export function resetSearchScreenMemory(providerId?: string) {
  if (providerId) {
    memoryByProvider.set(providerId, getDefaultMemory());
    return;
  }

  memoryByProvider.clear();
}
