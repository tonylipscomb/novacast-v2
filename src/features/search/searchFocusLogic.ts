import { searchResultKey } from './searchScopes.ts';
import type { GroupedSearchResults, SearchResult, SearchScope } from './searchTypes.ts';

export function collectVisibleSearchResultKeys(
  scope: SearchScope,
  results: SearchResult[],
  groupedResults: GroupedSearchResults | null,
): Set<string> {
  const keys = new Set<string>();

  if (scope === 'all' && groupedResults) {
    for (const section of [groupedResults.live, groupedResults.movie, groupedResults.series, groupedResults.guide]) {
      for (const item of section.items) {
        keys.add(searchResultKey(item as SearchResult));
      }
    }
    return keys;
  }

  for (const item of results) {
    keys.add(searchResultKey(item));
  }

  return keys;
}

export function isSearchFocusKeyVisible(focusedResultKey: string | null, visibleKeys: Set<string>) {
  return focusedResultKey !== null && visibleKeys.has(focusedResultKey);
}
