import type { SearchScope } from './searchTypes';

export const SEARCH_SCOPES: SearchScope[] = ['all', 'live', 'movie', 'series', 'guide'];

export function searchScopeLabel(scope: SearchScope) {
  switch (scope) {
    case 'all':
      return 'All';
    case 'live':
      return 'Live TV';
    case 'movie':
      return 'Movies';
    case 'series':
      return 'Series';
    case 'guide':
      return 'Guide';
    default:
      return scope;
  }
}

export function scopedSearchEmptyHint(scope: SearchScope) {
  switch (scope) {
    case 'live':
      return 'Search Live TV channels and current programs.';
    case 'movie':
      return 'Search movies by title, genre, cast, or year.';
    case 'series':
      return 'Search series by title, genre, cast, or year.';
    case 'guide':
      return 'Search Guide channels and programs.';
    default:
      return 'Search across Live TV, Movies, Series, and Guide.';
  }
}

export function searchResultKey(result: { type: string; id: string; programId?: string }) {
  if (result.type === 'guide' && result.programId) {
    return `guide:${result.id}:${result.programId}`;
  }

  return `${result.type}:${result.id}`;
}
