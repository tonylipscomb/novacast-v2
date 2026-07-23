import type { ProviderSearchHit } from '@/features/providers/providerRepositories';

import { SEARCH_MIN_QUERY_LENGTH } from './searchConstants.ts';
import type { GroupedSearchResults, SearchLoadStatus, SearchPageResult, SearchResult, SearchScope } from './searchTypes';

export { SEARCH_MIN_QUERY_LENGTH };

export type SearchNotificationSpec = {
  title: string;
  message: string;
  persistent: boolean;
};

export const SEARCH_NOTIFICATION_ID = 'search-unavailable';
export const SEARCH_NOTIFICATION_DURATION_MS = 7000;

/** Only active search failures become toasts; idle/empty/loading stay inline. */
export function resolveSearchNotificationForStatus(
  status: SearchLoadStatus,
  retryAttemptedAndStillFailing: boolean,
  errorMessage?: string | null,
): SearchNotificationSpec | null {
  if (status !== 'error') {
    return null;
  }

  return {
    title: 'Search unavailable',
    message: errorMessage?.trim() || 'We could not search your provider library right now.',
    persistent: retryAttemptedAndStillFailing,
  };
}

export function searchHitKey(hit: ProviderSearchHit) {
  return `${hit.kind}:${hit.id}`;
}

export function searchHitKindLabel(kind: ProviderSearchHit['kind']) {
  if (kind === 'movie') {
    return 'Movie';
  }

  if (kind === 'series') {
    return 'Series';
  }

  return 'Live TV';
}

export function shouldApplySearchResult(requestId: number, currentRequestId: number, aborted: boolean) {
  return requestId === currentRequestId && !aborted;
}

export function resolveSearchStatusAfterResults(totalCount: number): SearchLoadStatus {
  return totalCount > 0 ? 'ready' : 'empty';
}

/** Reuse All-tab preview results when switching to a scoped tab with the same query. */
export function resolveScopedSeedFromGrouped(
  grouped: GroupedSearchResults | null | undefined,
  scope: SearchScope,
): SearchPageResult<SearchResult> | null {
  if (!grouped || scope === 'all') {
    return null;
  }

  const page =
    scope === 'live'
      ? grouped.live
      : scope === 'movie'
        ? grouped.movie
        : scope === 'series'
          ? grouped.series
          : grouped.guide;

  return page.items.length > 0 ? (page as SearchPageResult<SearchResult>) : null;
}
