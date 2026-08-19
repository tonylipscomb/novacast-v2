/**
 * Diagnostics-only controlled Movies search probe (no keyboard automation).
 * Enabled when EXPO_PUBLIC_MOVIES_SEARCH_PERF_PROBE=true.
 */

import { novacastTrace } from '../diagnostics/novacastLogPolicy.ts';
import type { MovieDataSource } from '../movies/data/MovieDataSource.ts';

import {
  beginMoviesSearchInput,
  markMoviesSearchDebounceReleased,
  markMoviesSearchQueryFinished,
  markMoviesSearchStateApplied,
} from './moviesSearchPerfDiagnostics.ts';
import { searchMovies } from './repositories/movieSearchRepository.ts';
import { normalizeSearchQuery } from './searchQuery.ts';
import { SEARCH_DEBOUNCE_MS, SEARCH_PAGE_SIZE } from './searchConstants.ts';

const PROBE_QUERIES = ['bat', 'batman', 'spider', 'love', 'zzzxqwnonexistent999'] as const;
const probedProviders = new Set<string>();

export function isMoviesSearchPerfProbeEnabled() {
  return (
    process.env.EXPO_PUBLIC_MOVIES_SEARCH_PERF_PROBE === 'true' ||
    // Fallback: diagnostic APKs already ship SQLite Movies diagnostics.
    process.env.EXPO_PUBLIC_MOVIES_SQLITE_DIAGNOSTICS === 'true'
  );
}

export async function runMoviesSearchPerfProbeOnce(input: {
  providerId: string;
  dataSource: MovieDataSource | null | undefined;
}) {
  if (!isMoviesSearchPerfProbeEnabled()) {
    return;
  }
  if (!input.providerId || probedProviders.has(input.providerId)) {
    return;
  }
  probedProviders.add(input.providerId);

  novacastTrace(
    '[NovaCast Movies Search Probe] ' +
      JSON.stringify({
        providerId: input.providerId,
        queries: PROBE_QUERIES,
        marker: 'stage-movies-search-perf-audit-v1',
      }),
  );

  for (const query of PROBE_QUERIES) {
    const requestId = beginMoviesSearchInput({
      query,
      normalizedQueryLength: normalizeSearchQuery(query).length,
      debounceMs: SEARCH_DEBOUNCE_MS,
      previousRequestCancelled: false,
    });
    markMoviesSearchDebounceReleased(requestId);
    const startedAt = Date.now();
    try {
      const page = await searchMovies(input.providerId, input.dataSource, {
        providerId: input.providerId,
        query,
        offset: 0,
        limit: SEARCH_PAGE_SIZE,
      });
      markMoviesSearchQueryFinished(requestId, page.totalCount);
      markMoviesSearchStateApplied(requestId, page.items.length);
      novacastTrace(
        '[NovaCast Movies Search Probe Result] ' +
          JSON.stringify({
            requestId,
            query,
            resultCount: page.totalCount,
            returnedCount: page.items.length,
            totalMs: Date.now() - startedAt,
            marker: 'stage-movies-search-perf-audit-v1',
          }),
      );
    } catch (error) {
      novacastTrace(
        '[NovaCast Movies Search Probe Result] ' +
          JSON.stringify({
            requestId,
            query,
            error: error instanceof Error ? error.message : String(error),
            totalMs: Date.now() - startedAt,
            marker: 'stage-movies-search-perf-audit-v1',
          }),
      );
    }
  }
}

export function resetMoviesSearchPerfProbeForTests() {
  probedProviders.clear();
}
