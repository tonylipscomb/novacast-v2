/* eslint-disable react-hooks/set-state-in-effect -- Debounced search applies async results in effects. */
import { useCallback, useEffect, useRef, useState } from 'react';

import { logSearchEvent } from './searchDiagnostics';
import { SEARCH_DEBOUNCE_MS } from './searchConstants';
import { isSearchableQuery } from './searchQuery';
import type { SearchLoadStatus, SearchScope } from './searchTypes';

type UseSearchControllerOptions<T> = {
  scope: SearchScope;
  providerId: string;
  enabled?: boolean;
  pageSize?: number;
  executeSearch: (
    request: {
      providerId: string;
      query: string;
      limit: number;
      offset: number;
      signal: AbortSignal;
    },
  ) => Promise<{ items: T[]; totalCount: number; hasMore: boolean }>;
  onQueryCommitted?: (query: string) => void;
};

export function useSearchController<T>(options: UseSearchControllerOptions<T>) {
  const { scope, providerId, enabled = true, pageSize = 50, executeSearch, onQueryCommitted } = options;
  const executeSearchRef = useRef(executeSearch);
  executeSearchRef.current = executeSearch;
  const onQueryCommittedRef = useRef(onQueryCommitted);
  onQueryCommittedRef.current = onQueryCommitted;
  const [query, setQueryState] = useState('');
  const [results, setResults] = useState<T[]>([]);
  const [status, setStatus] = useState<SearchLoadStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const offsetRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const [reloadToken, setReloadToken] = useState(0);

  const setQuery = useCallback((nextQuery: string) => {
    setQueryState(nextQuery);
  }, []);

  const clearQuery = useCallback(() => {
    setQueryState('');
  }, []);

  const reload = useCallback(() => {
    setReloadToken((current) => current + 1);
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    offsetRef.current = 0;
    setQueryState('');
    setResults([]);
    setStatus('idle');
    setErrorMessage(null);
    setTotalCount(0);
    setHasMore(false);
  }, []);

  useEffect(() => {
    reset();
  }, [providerId, reset, scope]);

  useEffect(() => {
    if (!enabled) {
      abortRef.current?.abort();
      setResults([]);
      setStatus('idle');
      setErrorMessage(null);
      return;
    }

    const trimmed = query.trim();
    if (!isSearchableQuery(trimmed)) {
      abortRef.current?.abort();
      abortRef.current = null;
      offsetRef.current = 0;
      setResults([]);
      setErrorMessage(null);
      setTotalCount(0);
      setHasMore(false);
      setStatus('idle');
      return;
    }

    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    offsetRef.current = 0;

    setStatus('loading');
    setErrorMessage(null);

    const timer = setTimeout(() => {
      const startedAt = Date.now();
      logSearchEvent('search_debounce_fire', {
        scope,
        queryLength: trimmed.length,
        providerId,
      });
      void executeSearchRef.current({
        providerId,
        query: trimmed,
        limit: pageSize,
        offset: 0,
        signal: controller.signal,
      })
        .then((page) => {
          if (requestId !== requestIdRef.current || controller.signal.aborted) {
            return;
          }

          const posterMissing = page.items.filter(
            (item) => item && typeof item === 'object' && 'posterUrl' in item && !(item as { posterUrl?: string }).posterUrl,
          ).length;

          logSearchEvent('search_query_done', {
            scope,
            queryLength: trimmed.length,
            returnedCount: page.items.length,
            totalCount: page.totalCount,
            posterMissing,
            durationMs: Date.now() - startedAt,
          });

          offsetRef.current = page.items.length;
          setResults(page.items);
          setTotalCount(page.totalCount);
          setHasMore(page.hasMore);
          setStatus(page.items.length > 0 ? 'ready' : 'empty');
          onQueryCommittedRef.current?.(trimmed);
        })
        .catch((error) => {
          if (requestId !== requestIdRef.current || controller.signal.aborted) {
            return;
          }

          logSearchEvent('search_query_error', {
            scope,
            queryLength: trimmed.length,
            message: error instanceof Error ? error.message : 'unknown',
            durationMs: Date.now() - startedAt,
          });

          setResults([]);
          setTotalCount(0);
          setHasMore(false);
          setStatus('error');
          setErrorMessage(error instanceof Error ? error.message : 'Unable to search right now.');
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, pageSize, providerId, query, reloadToken]);

  const loadMore = useCallback(async () => {
    const trimmed = query.trim();
    if (!enabled || !isSearchableQuery(trimmed) || !hasMore || status === 'loading' || loadingMoreRef.current) {
      return;
    }

    loadingMoreRef.current = true;
    const requestId = requestIdRef.current;
    const controller = new AbortController();
    // Do not abort the main request id / prior pages — that remounts results and drops TV focus.
    const previousAbort = abortRef.current;
    abortRef.current = controller;

    try {
      const page = await executeSearchRef.current({
        providerId,
        query: trimmed,
        limit: pageSize,
        offset: offsetRef.current,
        signal: controller.signal,
      });

      if (requestId !== requestIdRef.current || controller.signal.aborted) {
        return;
      }

      offsetRef.current += page.items.length;
      setResults((current) => [...current, ...page.items]);
      setTotalCount(page.totalCount);
      setHasMore(page.hasMore);
      setStatus(page.items.length > 0 || offsetRef.current > 0 ? 'ready' : 'empty');
    } catch (error) {
      if (requestId !== requestIdRef.current || controller.signal.aborted) {
        return;
      }

      // Keep existing results visible; only surface a soft failure for pagination.
      setErrorMessage(error instanceof Error ? error.message : 'Unable to load more results.');
    } finally {
      loadingMoreRef.current = false;
      if (abortRef.current === controller) {
        abortRef.current = previousAbort;
      }
    }
  }, [enabled, hasMore, pageSize, providerId, query, status]);

  return {
    scope,
    query,
    setQuery,
    clearQuery,
    results,
    status,
    errorMessage,
    totalCount,
    hasMore,
    reload,
    loadMore,
    reset,
  };
}

