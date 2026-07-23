import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { NovaTvShell, type NovaNavigationFocusHandles } from '@/components/nova';
import { NovaFocusRow } from '@/components/nova/NovaFocusRow';
import { novaTvFocus } from '@/components/nova/novaTvFocus';
import { isDiscoverCollectionsPending, useCatalogSyncStatus } from '@/features/hub/useCatalogSyncStatus';
import { createTvNavigationGate, tryAcquireTvNavigationGate } from '@/features/navigation/tvNavigation';
import { TV_HOME_ROUTE } from '@/features/navigation/tvRoutes';
import { useAppNotification } from '@/features/notifications/useAppNotification';
import { useActiveProviderBundle } from '@/features/providers/useActiveProviderBundle';
import { useProviderStore } from '@/features/providers/providerStore';
import { novaTheme } from '@/theme';

import { SearchEmptyState } from './SearchEmptyState';
import { SearchInput } from './SearchInput';
import { SearchLoadingState } from './SearchLoadingState';
import { SearchPosterGrid } from './SearchPosterGrid';
import { SearchResults } from './SearchResults';
import { SearchScopeChips } from './SearchScopeChips';
import { SearchSection } from './SearchSection';
import { SearchMediaDetailLayer } from './SearchMediaDetailLayer';
import { openSearchResult } from './searchNavigation';
import { isSearchableQuery } from './searchQuery';
import { searchResultKey } from './searchScopes';
import { getSearchScreenMemory, rememberSearchScreenMemory } from './searchScreenMemory';
import { collectVisibleSearchResultKeys, isSearchFocusKeyVisible } from './searchFocusLogic';
import {
  SEARCH_NOTIFICATION_DURATION_MS,
  SEARCH_NOTIFICATION_ID,
  resolveSearchNotificationForStatus,
} from './searchScreenLogic';
import type { SearchResult, SearchScope } from './searchTypes';
import { useSearchMediaDetail } from './useSearchMediaDetail';
import { useSearchScreenModel } from './useSearchScreenModel';
import { useStableNodeHandle } from './useStableNodeHandle';

function resolveIndexStatusMessage(
  scope: SearchScope,
  catalogSyncPending: boolean,
  indexReadiness: ReturnType<typeof useSearchScreenModel>['indexReadiness'],
) {
  if (!catalogSyncPending && indexReadiness?.anyReady) {
    return null;
  }

  if (scope === 'movie' && indexReadiness && !indexReadiness.moviesReady) {
    return 'Preparing your movie library for search…';
  }

  if (scope === 'series' && indexReadiness && !indexReadiness.seriesReady) {
    return 'Preparing your series library for search…';
  }

  if (scope === 'live' && indexReadiness && !indexReadiness.liveReady) {
    return 'Open Live TV once to index channels for faster search.';
  }

  if (scope === 'guide' && indexReadiness && !indexReadiness.guideReady) {
    return 'Open the Guide once to index programs for faster search.';
  }

  if (catalogSyncPending) {
    return 'Building your searchable library…';
  }

  return null;
}

export function SearchScreen() {
  const router = useRouter();
  const navigationGateRef = useRef(createTvNavigationGate());
  const searchShellRef = useRef<View>(null);
  const searchInputRef = useRef<TextInput>(null);
  const clearHistoryRef = useRef<View>(null);
  const firstHistoryRowRef = useRef<View>(null);
  const emptyClearRef = useRef<View>(null);
  const retryRowRef = useRef<View>(null);
  const firstFlatResultRef = useRef<View>(null);
  const firstGroupedResultRef = useRef<View>(null);
  const firstScopeTabRef = useRef<View>(null);
  const [navFocusHandles, setNavFocusHandles] = useState<NovaNavigationFocusHandles>({});
  const [focusedClearHistory, setFocusedClearHistory] = useState(false);
  const searchRetryAttemptedRef = useRef(false);
  const lastRetryAtRef = useRef(0);
  const { selectedProvider, selectedProviderLabel } = useProviderStore();
  const { bundle } = useActiveProviderBundle();
  const activeProviderId = selectedProvider?.id ?? 'no-provider';
  const searchMedia = useSearchMediaDetail(activeProviderId, bundle);
  const [focusedResultKey, setFocusedResultKeyState] = useState<string | null>(
    () => (activeProviderId !== 'no-provider' ? getSearchScreenMemory(activeProviderId).focusedResultKey : null),
  );
  const catalogSyncPhase = useCatalogSyncStatus(activeProviderId);
  const catalogSyncPending = isDiscoverCollectionsPending(catalogSyncPhase);
  const { showNotification, dismissNotification, clearScope } = useAppNotification();
  const {
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
    hasDataSource,
  } = useSearchScreenModel();

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (searchMedia.detailOpen) {
        searchMedia.closeDetail();
        return true;
      }

      if (searchMedia.playbackClosing) {
        return true;
      }

      if (searchMedia.playbackActive) {
        searchMedia.closePlayback();
        return true;
      }

      if (!tryAcquireTvNavigationGate(navigationGateRef.current)) {
        return true;
      }

      router.replace(TV_HOME_ROUTE);
      return true;
    });

    return () => subscription.remove();
  }, [
    router,
    searchMedia.closeDetail,
    searchMedia.closePlayback,
    searchMedia.detailOpen,
    searchMedia.playbackActive,
    searchMedia.playbackClosing,
  ]);

  useEffect(() => {
    if (!searchMedia.didJustClose) {
      return;
    }

    searchMedia.handlePlaybackClosed();
  }, [searchMedia.didJustClose, searchMedia.handlePlaybackClosed]);

  const handleReload = useCallback(() => {
    const now = Date.now();
    if (now - lastRetryAtRef.current < 400) {
      return;
    }

    lastRetryAtRef.current = now;
    searchRetryAttemptedRef.current = true;
    reload();
  }, [reload]);

  useEffect(() => {
    if (status === 'ready') {
      searchRetryAttemptedRef.current = false;
    }
  }, [status]);

  useEffect(() => {
    if (!hasDataSource || !isSearchableQuery(query)) {
      dismissNotification(SEARCH_NOTIFICATION_ID);
      return;
    }

    const spec = resolveSearchNotificationForStatus(status, searchRetryAttemptedRef.current, errorMessage);
    if (!spec) {
      dismissNotification(SEARCH_NOTIFICATION_ID);
      return;
    }

    showNotification({
      id: SEARCH_NOTIFICATION_ID,
      type: 'error',
      title: spec.title,
      message: spec.message,
      actionLabel: 'Retry',
      onAction: handleReload,
      duration: SEARCH_NOTIFICATION_DURATION_MS,
      persistent: spec.persistent,
      position: 'bottom-right',
      scope: 'search',
    });
  }, [dismissNotification, errorMessage, handleReload, hasDataSource, query, showNotification, status]);

  useEffect(() => {
    return () => {
      clearScope('search');
    };
  }, [clearScope]);

  const setFocusedResultKey = useCallback(
    (key: string) => {
      setFocusedResultKeyState(key);
      if (activeProviderId !== 'no-provider') {
        rememberSearchScreenMemory(activeProviderId, { focusedResultKey: key });
      }
    },
    [activeProviderId],
  );

  const handleSelectResult = useCallback(
    (result: SearchResult) => {
      const key = searchResultKey(result);
      setFocusedResultKey(key);

      if (result.type === 'movie' || result.type === 'series') {
        rememberSearchScreenMemory(activeProviderId, {
          query,
          scope,
          focusedResultKey: key,
        });
        searchMedia.openFromSearchResult(result);
        return;
      }

      openSearchResult(router, activeProviderId, result, { query, scope, focusedResultKey: key });
    },
    [activeProviderId, query, router, scope, searchMedia, setFocusedResultKey],
  );

  useEffect(() => {
    if (!focusedResultKey) {
      return;
    }

    const visibleKeys = collectVisibleSearchResultKeys(scope, results, groupedResults);
    if (!isSearchFocusKeyVisible(focusedResultKey, visibleKeys)) {
      setFocusedResultKeyState(null);
      if (activeProviderId !== 'no-provider') {
        rememberSearchScreenMemory(activeProviderId, { focusedResultKey: null });
      }
    }
  }, [activeProviderId, focusedResultKey, groupedResults, results, scope]);

  const trimmedQuery = query.trim();
  const showIdle = !isSearchableQuery(trimmedQuery);
  const showError = !showIdle && status === 'error';
  const showEmpty = !showIdle && status === 'empty';
  const showGrouped = !showIdle && !showError && scope === 'all' && groupedResults;
  const showFlatResults = !showIdle && !showError && scope !== 'all';

  const searchFocusUpHandle = useStableNodeHandle(searchShellRef, [
    showIdle,
    showEmpty,
    showGrouped,
    showFlatResults,
  ]);
  const firstScopeTabHandle = useStableNodeHandle(firstScopeTabRef, [scope]);
  const clearHistoryFocusHandle = useStableNodeHandle(clearHistoryRef, [history.length, showIdle]);
  const firstHistoryFocusHandle = useStableNodeHandle(firstHistoryRowRef, [history.length, showIdle]);
  const emptyClearFocusHandle = useStableNodeHandle(emptyClearRef, [showEmpty, scope, trimmedQuery]);
  const retryFocusHandle = useStableNodeHandle(retryRowRef, [showError, scope, errorMessage]);
  const firstFlatResultFocusHandle = useStableNodeHandle(firstFlatResultRef, [showFlatResults, scope, results.length]);
  const firstGroupedResultFocusHandle = useStableNodeHandle(firstGroupedResultRef, [showGrouped, groupedResults]);
  const navLeftHandle = navFocusHandles.search;

  const resolvedScopeFocusDownHandle = useMemo(() => {
    if (showIdle && history.length > 0) {
      return clearHistoryFocusHandle;
    }
    if (showEmpty) {
      return emptyClearFocusHandle;
    }
    if (showError) {
      return retryFocusHandle;
    }
    if (showFlatResults && results.length > 0) {
      return firstFlatResultFocusHandle;
    }
    if (showGrouped) {
      return firstGroupedResultFocusHandle;
    }
    return undefined;
  }, [
    showIdle,
    showEmpty,
    showError,
    showFlatResults,
    showGrouped,
    history.length,
    results.length,
    clearHistoryFocusHandle,
    emptyClearFocusHandle,
    retryFocusHandle,
    firstFlatResultFocusHandle,
    firstGroupedResultFocusHandle,
  ]);

  if (!hasDataSource) {
    return (
      <NovaTvShell activeId="search" title="Search" subtitle="Find anything across NovaCast." preferActiveNavigationFocus={false} compactNavigationRail>
        <View style={styles.statePanel}>
          <MaterialCommunityIcons name="alert-circle-outline" size={34} color={novaTheme.colors.warning} />
          <Text style={styles.stateTitle}>Search unavailable</Text>
          <Text style={styles.stateCopy}>Connect a provider to search your library.</Text>
        </View>
      </NovaTvShell>
    );
  }

  const indexStatusMessage = resolveIndexStatusMessage(scope, catalogSyncPending, indexReadiness);
  const emptyResultsMessage = catalogSyncPending
    ? `No matches yet for “${trimmedQuery}”. Your library is still indexing — results improve as indexing finishes.`
    : undefined;

  return (
    <NovaTvShell
      activeId="search"
      title="Search"
      subtitle="Movies, series, channels, and programs."
      providerLabel={selectedProviderLabel}
      preferActiveNavigationFocus={false}
      onNavigationFocusHandles={setNavFocusHandles}
      navigationContentFocusHandle={searchFocusUpHandle}
      compactNavigationRail>
      <View style={styles.screen} pointerEvents={searchMedia.detailOpen || searchMedia.playbackActive ? 'none' : 'auto'}>
        <SearchInput
          focusRef={searchShellRef}
          inputRef={searchInputRef}
          value={query}
          onChangeText={setQuery}
          placeholder="Search movies, series, channels, and programs"
          focusLeftHandle={navLeftHandle}
          focusDownHandle={firstScopeTabHandle}
          onSubmit={() => searchInputRef.current?.blur()}
        />

        <SearchScopeChips
          activeScope={scope}
          onSelectScope={setScope}
          focusUpHandle={searchFocusUpHandle}
          focusDownHandle={resolvedScopeFocusDownHandle}
          focusLeftHandle={navLeftHandle}
          firstTabRef={firstScopeTabRef}
        />

        {indexStatusMessage ? (
          <Text style={styles.indexStatus}>{indexStatusMessage}</Text>
        ) : null}

        {showIdle ? (
          <View style={styles.idlePanel}>
            <SearchEmptyState scope="all" mode="idle" />
            {history.length > 0 ? (
              <View style={styles.historyPanel}>
                <View style={styles.historyHeader}>
                  <Text style={styles.historyTitle}>Recent searches</Text>
                  <Pressable
                    ref={clearHistoryRef}
                    focusable
                    accessibilityRole="button"
                    accessibilityLabel="Clear search history"
                    onPress={clearHistory}
                    onFocus={() => setFocusedClearHistory(true)}
                    onBlur={() => setFocusedClearHistory(false)}
                    {...(searchFocusUpHandle ? { nextFocusUp: searchFocusUpHandle } : null)}
                    {...(firstHistoryFocusHandle ? { nextFocusDown: firstHistoryFocusHandle } : null)}
                    style={[styles.historyClearButton, novaTvFocus.base, focusedClearHistory && novaTvFocus.active]}>
                    <Text style={[styles.historyClear, focusedClearHistory && styles.historyClearFocused]}>Clear</Text>
                  </Pressable>
                </View>
                {history.map((entry, index) => (
                  <NovaFocusRow
                    key={`${entry.query}:${entry.timestamp}`}
                    title={entry.query}
                    meta="Recent"
                    emphasized
                    nativeRef={index === 0 ? firstHistoryRowRef : undefined}
                    nextFocusUp={index === 0 ? clearHistoryFocusHandle : undefined}
                    onPress={() => setQuery(entry.query)}
                    accessibilityLabel={`Search for ${entry.query}`}
                    trailing={<MaterialCommunityIcons name="history" size={16} color={novaTheme.colors.textMuted} />}
                  />
                ))}
              </View>
            ) : null}
          </View>
        ) : showError ? (
          <SearchEmptyState
            scope={scope}
            mode="error"
            errorMessage={errorMessage}
            onRetry={handleReload}
            retryRowRef={retryRowRef}
            focusUpHandle={searchFocusUpHandle}
          />
        ) : showEmpty ? (
          <SearchEmptyState
            scope={scope}
            mode="empty"
            query={trimmedQuery}
            message={emptyResultsMessage}
            onClear={() => setQuery('')}
            clearRowRef={emptyClearRef}
            focusUpHandle={searchFocusUpHandle}
          />
        ) : showGrouped ? (
          <ScrollView focusable={false} showsVerticalScrollIndicator={false} contentContainerStyle={styles.groupedContent}>
            {status === 'loading' && groupedResults.live.items.length === 0 && groupedResults.movie.items.length === 0 ? (
              <SearchLoadingState label="Searching your library…" />
            ) : null}
            <SearchSection
              scope="live"
              page={{ ...groupedResults.live, items: groupedResults.live.items as SearchResult[] }}
              loading={status === 'loading' && groupedResults.live.items.length === 0}
              focusedResultKey={focusedResultKey}
              onFocusResult={setFocusedResultKey}
              onSelectResult={handleSelectResult}
              onViewAll={groupedResults.live.hasMore ? () => setScope('live') : undefined}
              focusUpHandle={searchFocusUpHandle}
              firstRowRef={groupedResults.live.items.length > 0 ? firstGroupedResultRef : undefined}
            />
            <SearchSection
              scope="movie"
              page={{ ...groupedResults.movie, items: groupedResults.movie.items as SearchResult[] }}
              loading={status === 'loading' && groupedResults.movie.items.length === 0}
              focusedResultKey={focusedResultKey}
              onFocusResult={setFocusedResultKey}
              onSelectResult={handleSelectResult}
              onViewAll={groupedResults.movie.hasMore ? () => setScope('movie') : undefined}
              firstRowRef={
                groupedResults.live.items.length === 0 && groupedResults.movie.items.length > 0
                  ? firstGroupedResultRef
                  : undefined
              }
            />
            <SearchSection
              scope="series"
              page={{ ...groupedResults.series, items: groupedResults.series.items as SearchResult[] }}
              loading={status === 'loading' && groupedResults.series.items.length === 0}
              focusedResultKey={focusedResultKey}
              onFocusResult={setFocusedResultKey}
              onSelectResult={handleSelectResult}
              onViewAll={groupedResults.series.hasMore ? () => setScope('series') : undefined}
              firstRowRef={
                groupedResults.live.items.length === 0 &&
                groupedResults.movie.items.length === 0 &&
                groupedResults.series.items.length > 0
                  ? firstGroupedResultRef
                  : undefined
              }
            />
            <SearchSection
              scope="guide"
              page={{ ...groupedResults.guide, items: groupedResults.guide.items as SearchResult[] }}
              loading={status === 'loading' && groupedResults.guide.items.length === 0}
              focusedResultKey={focusedResultKey}
              onFocusResult={setFocusedResultKey}
              onSelectResult={handleSelectResult}
              onViewAll={groupedResults.guide.hasMore ? () => setScope('guide') : undefined}
              firstRowRef={
                groupedResults.live.items.length === 0 &&
                groupedResults.movie.items.length === 0 &&
                groupedResults.series.items.length === 0 &&
                groupedResults.guide.items.length > 0
                  ? firstGroupedResultRef
                  : undefined
              }
            />
          </ScrollView>
        ) : showFlatResults ? (
          scope === 'movie' || scope === 'series' ? (
            <SearchPosterGrid
              results={results}
              focusedResultKey={focusedResultKey}
              onFocusResult={setFocusedResultKey}
              onSelectResult={handleSelectResult}
              loadingMore={loadingMore}
              focusUpHandle={searchFocusUpHandle}
              onEndReached={() => {
                if (hasMore && !loadingMore) {
                  void loadMore();
                }
              }}
              listHeader={
                <View style={styles.resultsHeader}>
                  {status === 'loading' && results.length === 0 ? (
                    <SearchLoadingState label={`Searching ${scope === 'movie' ? 'movies' : 'series'}…`} />
                  ) : (
                    <Text style={styles.resultsCount}>{totalCount.toLocaleString()} results</Text>
                  )}
                </View>
              }
              listFooter={loadingMore ? <SearchLoadingState label="Loading more…" compact /> : null}
            />
          ) : (
            <FlatList
              focusable={false}
              data={results}
              keyExtractor={(item) => searchResultKey(item)}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.resultsList}
              onEndReached={() => {
                if (hasMore && !loadingMore) {
                  void loadMore();
                }
              }}
              onEndReachedThreshold={0.4}
              ListHeaderComponent={
                <View style={styles.resultsHeader}>
                  {status === 'loading' && results.length === 0 ? (
                    <SearchLoadingState label={`Searching ${scope}…`} />
                  ) : (
                    <Text style={styles.resultsCount}>{totalCount.toLocaleString()} results</Text>
                  )}
                </View>
              }
              ListFooterComponent={loadingMore ? <SearchLoadingState label="Loading more…" compact /> : null}
              renderItem={({ item, index }) => (
                <SearchResults
                  results={[item]}
                  focusedResultKey={focusedResultKey}
                  onFocusResult={setFocusedResultKey}
                  onSelectResult={handleSelectResult}
                  emphasized
                  focusUpHandle={index === 0 ? searchFocusUpHandle : undefined}
                  firstRowRef={index === 0 ? firstFlatResultRef : undefined}
                />
              )}
            />
          )
        ) : null}
      </View>

      <SearchMediaDetailLayer media={searchMedia} />
    </NovaTvShell>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    minHeight: 0,
    gap: novaTheme.density.sectionGap,
    paddingTop: 2,
  },
  indexStatus: {
    color: novaTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 4,
  },
  idlePanel: {
    flex: 1,
    gap: novaTheme.density.sectionGap,
  },
  historyPanel: {
    gap: 0,
    paddingTop: 4,
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingBottom: 6,
  },
  historyTitle: {
    color: novaTheme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  historyClear: {
    color: novaTheme.colors.accentHover,
    fontSize: 12,
    fontWeight: '700',
  },
  historyClearFocused: {
    color: novaTheme.colors.textPrimary,
    fontWeight: '800',
  },
  historyClearButton: {
    minWidth: 48,
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 0,
    paddingHorizontal: 6,
  },
  groupedContent: {
    paddingBottom: 20,
  },
  resultsList: {
    paddingBottom: 20,
  },
  resultsHeader: {
    paddingHorizontal: 4,
    paddingBottom: 6,
  },
  resultsCount: {
    color: novaTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  statePanel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 24,
  },
  stateTitle: {
    color: novaTheme.colors.textPrimary,
    fontSize: 24,
    fontWeight: '800',
  },
  stateCopy: {
    color: novaTheme.colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
