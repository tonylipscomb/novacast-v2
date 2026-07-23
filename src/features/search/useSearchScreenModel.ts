/* eslint-disable react-hooks/set-state-in-effect -- Debounced provider search resets and applies async results in one effect. */
import { useCallback, useEffect, useRef, useState } from 'react';

import { useActiveProviderBundle } from '@/features/providers/useActiveProviderBundle';
import { subscribeCatalogSyncPhase } from '@/features/providers/providerCatalogSync';

import { addSearchHistoryEntry, clearSearchHistory, readSearchHistory } from './searchHistoryStore';
import {
  createEmptyGroupedResults,
  defaultScopedSearchPageSize,
  searchByScope,
  searchGlobalGroupedIncremental,
} from './repositories/globalSearchRepository';
import { getSearchIndexReadiness, type SearchIndexReadiness } from './searchIndexReadiness';
import { isSearchableQuery } from './searchQuery';
import { SEARCH_DEBOUNCE_MS } from './searchConstants';
import { getSearchScreenMemory, rememberSearchScreenMemory } from './searchScreenMemory';
import { resolveSearchStatusAfterResults, resolveScopedSeedFromGrouped, shouldApplySearchResult } from './searchScreenLogic';
import type { GroupedSearchResults, SearchHistoryEntry, SearchLoadStatus, SearchResult, SearchScope } from './searchTypes';

export function useSearchScreenModel() {
  const { bundle } = useActiveProviderBundle();
  const providerId = bundle?.providerId ?? '';
  const savedMemory = providerId ? getSearchScreenMemory(providerId) : null;
  const [query, setQueryState] = useState(savedMemory?.query ?? '');
  const [scope, setScopeState] = useState<SearchScope>(savedMemory?.scope ?? 'all');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [groupedResults, setGroupedResults] = useState<GroupedSearchResults | null>(null);
  const [status, setStatus] = useState<SearchLoadStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  const [indexReadiness, setIndexReadiness] = useState<SearchIndexReadiness | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const loadMoreSeqRef = useRef(0);
  const partialGroupedTotalRef = useRef(0);
  const scopedSeedCountRef = useRef(0);
  const groupedSnapshotRef = useRef<{ query: string; grouped: GroupedSearchResults } | null>(null);
  const offsetRef = useRef(0);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => {
    setReloadToken((current) => current + 1);
  }, []);

  const clearHistory = useCallback(() => {
    void clearSearchHistory().then(() => readSearchHistory().then(setHistory));
  }, []);

  const setQuery = useCallback(
    (nextQuery: string) => {
      setQueryState(nextQuery);
      if (providerId) {
        rememberSearchScreenMemory(providerId, { query: nextQuery });
      }
    },
    [providerId],
  );

  const setScope = useCallback(
    (nextScope: SearchScope) => {
      setScopeState(nextScope);
      if (providerId) {
        rememberSearchScreenMemory(providerId, { scope: nextScope });
      }
    },
    [providerId],
  );

  useEffect(() => {
    void readSearchHistory().then(setHistory);
  }, []);

  useEffect(() => {
    if (!bundle) {
      setIndexReadiness(null);
      return;
    }

    const refresh = () => setIndexReadiness(getSearchIndexReadiness(bundle.providerId));
    refresh();
    return subscribeCatalogSyncPhase(bundle.providerId, refresh);
  }, [bundle]);

  useEffect(() => {
    if (!bundle) {
      return;
    }

    return subscribeCatalogSyncPhase(bundle.providerId, (phase) => {
      if (phase === 'ready' && isSearchableQuery(query.trim())) {
        setReloadToken((current) => current + 1);
      }
    });
  }, [bundle, query]);

  useEffect(() => {
    if (!bundle) {
      setResults([]);
      setGroupedResults(null);
      setStatus('idle');
      setErrorMessage(null);
      setTotalCount(0);
      setHasMore(false);
      return;
    }

    const trimmed = query.trim();
    if (!isSearchableQuery(trimmed)) {
    abortRef.current?.abort();
    abortRef.current = null;
    loadMoreAbortRef.current?.abort();
    loadMoreAbortRef.current = null;
    loadMoreSeqRef.current += 1;
    setLoadingMore(false);
    offsetRef.current = 0;
      setResults([]);
      setGroupedResults(null);
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
    loadMoreAbortRef.current?.abort();
    loadMoreAbortRef.current = null;
    loadMoreSeqRef.current += 1;
    setLoadingMore(false);
    offsetRef.current = 0;
    partialGroupedTotalRef.current = 0;
    scopedSeedCountRef.current = 0;

    if (groupedSnapshotRef.current?.query !== trimmed) {
      groupedSnapshotRef.current = null;
    }

    setErrorMessage(null);

    const seedGrouped =
      groupedSnapshotRef.current?.query === trimmed
        ? groupedSnapshotRef.current.grouped
        : groupedResults;
    const scopedSeed = scope !== 'all' ? resolveScopedSeedFromGrouped(seedGrouped, scope) : null;

    if (scope === 'all') {
      setStatus('loading');
      setGroupedResults(createEmptyGroupedResults());
    } else if (scopedSeed) {
      setGroupedResults(null);
      setResults([...scopedSeed.items]);
      offsetRef.current = scopedSeed.items.length;
      setTotalCount(scopedSeed.totalCount);
      setHasMore(scopedSeed.hasMore);
      setStatus(resolveSearchStatusAfterResults(scopedSeed.items.length));
      scopedSeedCountRef.current = scopedSeed.items.length;
    } else {
      setStatus('loading');
      setGroupedResults(null);
      setResults([]);
      setTotalCount(0);
      setHasMore(false);
    }

    const timer = setTimeout(() => {
      const runSearch = async () => {
        if (scope === 'all') {
          const grouped = await searchGlobalGroupedIncremental(bundle, trimmed, controller.signal, (partial) => {
            if (!shouldApplySearchResult(requestId, requestIdRef.current, controller.signal.aborted)) {
              return;
            }

            setGroupedResults({
              live: { ...partial.live, items: [...partial.live.items] },
              movie: { ...partial.movie, items: [...partial.movie.items] },
              series: { ...partial.series, items: [...partial.series.items] },
              guide: { ...partial.guide, items: [...partial.guide.items] },
            });
            groupedSnapshotRef.current = { query: trimmed, grouped: partial };
            partialGroupedTotalRef.current =
              partial.live.totalCount + partial.movie.totalCount + partial.series.totalCount + partial.guide.totalCount;
          });

          if (!shouldApplySearchResult(requestId, requestIdRef.current, controller.signal.aborted)) {
            return;
          }

          setGroupedResults(grouped);
          groupedSnapshotRef.current = { query: trimmed, grouped };
          setResults([]);
          const combinedTotal =
            grouped.live.totalCount + grouped.movie.totalCount + grouped.series.totalCount + grouped.guide.totalCount;
          setTotalCount(combinedTotal);
          setHasMore(
            grouped.live.hasMore || grouped.movie.hasMore || grouped.series.hasMore || grouped.guide.hasMore,
          );
          setStatus(resolveSearchStatusAfterResults(combinedTotal));
          void addSearchHistoryEntry(trimmed).then(setHistory);
          return;
        }

        const page = await searchByScope(bundle, scope, {
          providerId: bundle.providerId,
          query: trimmed,
          offset: 0,
          limit: defaultScopedSearchPageSize(scope),
          signal: controller.signal,
        });

        if (!shouldApplySearchResult(requestId, requestIdRef.current, controller.signal.aborted)) {
          return;
        }

        setGroupedResults(null);
        setResults(page.items);
        offsetRef.current = page.items.length;
        setTotalCount(page.totalCount);
        setHasMore(page.hasMore);
        setStatus(resolveSearchStatusAfterResults(page.items.length));
        scopedSeedCountRef.current = 0;
        void addSearchHistoryEntry(trimmed).then(setHistory);
      };

      void runSearch().catch((error) => {
        if (!shouldApplySearchResult(requestId, requestIdRef.current, controller.signal.aborted)) {
          return;
        }

        if (partialGroupedTotalRef.current > 0 || scopedSeedCountRef.current > 0) {
          setStatus('ready');
          return;
        }

        setGroupedResults(null);
        setTotalCount(0);
        setHasMore(false);
        setStatus('error');
        setErrorMessage(error instanceof Error ? error.message : 'Unable to search your provider library.');
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [bundle, query, reloadToken, scope]);

  const loadMore = useCallback(async () => {
    if (!bundle || scope === 'all' || !hasMore || status === 'loading' || loadingMore) {
      return;
    }

    const trimmed = query.trim();
    if (!isSearchableQuery(trimmed)) {
      return;
    }

    const loadMoreSeq = ++loadMoreSeqRef.current;
    const controller = new AbortController();
    loadMoreAbortRef.current?.abort();
    loadMoreAbortRef.current = controller;
    setLoadingMore(true);

    try {
      const page = await searchByScope(bundle, scope, {
        providerId: bundle.providerId,
        query: trimmed,
        offset: offsetRef.current,
        limit: defaultScopedSearchPageSize(scope),
        signal: controller.signal,
      });

      if (loadMoreSeq !== loadMoreSeqRef.current || controller.signal.aborted) {
        return;
      }

      offsetRef.current += page.items.length;
      setResults((current) => [...current, ...page.items]);
      setTotalCount(page.totalCount);
      setHasMore(page.hasMore);
    } catch (error) {
      if (loadMoreSeq !== loadMoreSeqRef.current || controller.signal.aborted) {
        return;
      }

      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Unable to load more results.');
    } finally {
      if (loadMoreSeq === loadMoreSeqRef.current) {
        setLoadingMore(false);
      }
    }
  }, [bundle, hasMore, loadingMore, query, scope, status]);

  return {
    query,
    setQuery,
    scope,
    setScope,
    results,
    groupedResults,
    status,
    errorMessage,
    totalCount,
    hasMore,
    history,
    indexReadiness,
    loadingMore,
    reload,
    loadMore,
    clearHistory,
    hasDataSource: Boolean(bundle),
  };
}
