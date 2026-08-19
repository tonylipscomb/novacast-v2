import type { RefObject } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import {
  FlatList,
  StyleSheet,
  View,
  type ListRenderItemInfo,
  type View as ViewType,
  type ViewToken,
} from 'react-native';

import { NovaFocusRow } from '@/components/nova/NovaFocusRow';
import { displayStreamTitle } from '@/features/series/metadata/titleNormalization';
import { novaTheme } from '@/theme';

import {
  LIVE_SEARCH_FOCUS_SCROLL_VIEW_POSITION,
  LIVE_SEARCH_RESULT_ROW_HEIGHT,
  liveSearchResultItemLayout,
  logLiveSearchFocus,
  planLiveSearchFocusScroll,
  planLiveSearchScrollToIndexFailedFallback,
  visibleRangeFromViewableItems,
  type LiveSearchFocusScrollPlan,
} from './liveSearchResultsScroll';
import { searchResultKey } from './searchScopes';
import type { LiveSearchResult, SearchResult } from './searchTypes';

type SearchResultsProps = {
  results: SearchResult[];
  focusedResultKey?: string | null;
  onFocusResult?: (key: string) => void;
  onSelectResult: (result: SearchResult) => void;
  header?: React.ReactNode;
  emphasized?: boolean;
  focusUpHandle?: number;
  focusLeftHandle?: number;
  firstRowRef?: RefObject<ViewType | null>;
  restoreResultKey?: string | null;
  restoreRowRef?: RefObject<ViewType | null>;
  favoriteContentIds?: ReadonlySet<string>;
  followFocusedResult?: boolean;
  onEndReached?: () => void;
  queryLength?: number;
  overlayVisible?: boolean;
};

function kindLabel(type: SearchResult['type']) {
  switch (type) {
    case 'movie':
      return 'Movie';
    case 'series':
      return 'Series';
    case 'live':
      return 'Live';
    case 'guide':
      return 'Guide';
    default:
      return 'Result';
  }
}

function liveSubtitle(result: LiveSearchResult) {
  const program = result.currentProgram ?? result.subtitle;
  if (program && result.categoryName) {
    return `${program} · ${result.categoryName}`;
  }
  return program || result.categoryName || 'Live channel';
}

function subtitleForResult(result: SearchResult) {
  if (result.type === 'movie') {
    return [result.year, result.rating].filter(Boolean).join(' · ') || 'Movie';
  }

  if (result.type === 'series') {
    return [result.year, result.rating].filter(Boolean).join(' · ') || 'Series';
  }

  if (result.type === 'live') {
    return liveSubtitle(result);
  }

  const timeParts: string[] = [];
  if (result.startsAt) {
    timeParts.push(new Date(result.startsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
  }
  if (result.endsAt) {
    timeParts.push(new Date(result.endsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
  }

  const statusLabel = result.status ? result.status.toUpperCase() : undefined;
  return [result.channelName, statusLabel, timeParts.join(' – ')].filter(Boolean).join(' · ');
}

function liveMeta(result: LiveSearchResult) {
  return result.channelNumber ? String(result.channelNumber) : 'Live';
}

function ResultRow({
  result,
  index,
  focusUpHandle,
  focusLeftHandle,
  firstRowRef,
  restoreResultKey,
  restoreRowRef,
  favoriteContentIds,
  onFocusResult,
  onSelectResult,
}: {
  result: SearchResult;
  index: number;
  focusUpHandle?: number;
  focusLeftHandle?: number;
  firstRowRef?: RefObject<ViewType | null>;
  restoreResultKey?: string | null;
  restoreRowRef?: RefObject<ViewType | null>;
  favoriteContentIds?: ReadonlySet<string>;
  onFocusResult?: (key: string) => void;
  onSelectResult: (result: SearchResult) => void;
}) {
  const key = searchResultKey(result);
  const isLive = result.type === 'live';
  const isFavorite = isLive && Boolean(favoriteContentIds?.has(result.id));
  const nativeRef =
    restoreResultKey && key === restoreResultKey ? restoreRowRef : index === 0 ? firstRowRef : undefined;

  return (
    <NovaFocusRow
      title={displayStreamTitle(result.title)}
      subtitle={subtitleForResult(result)}
      meta={isLive ? liveMeta(result) : kindLabel(result.type)}
      leading={
        isLive && result.logoUrl ? (
          <Image source={{ uri: result.logoUrl }} style={styles.liveLogo} contentFit="contain" />
        ) : undefined
      }
      nativeRef={nativeRef}
      nextFocusUp={index === 0 ? focusUpHandle : undefined}
      nextFocusLeft={index === 0 ? focusLeftHandle : undefined}
      onFocus={() => onFocusResult?.(key)}
      onPress={() => onSelectResult(result)}
      accessibilityLabel={`Open ${kindLabel(result.type)} ${result.title}`}
      trailing={
        <>
          {isLive ? (
            <MaterialCommunityIcons
              name={isFavorite ? 'star' : 'star-outline'}
              size={16}
              color={isFavorite ? novaTheme.colors.accentHover : novaTheme.colors.textMuted}
            />
          ) : null}
          <MaterialCommunityIcons name="chevron-right" size={18} color={novaTheme.colors.textMuted} />
        </>
      }
    />
  );
}

function StaticSearchResults({
  results,
  header,
  emphasized = false,
  focusedResultKey,
  onFocusResult,
  onSelectResult,
  focusUpHandle,
  focusLeftHandle,
  firstRowRef,
  restoreResultKey,
  restoreRowRef,
  favoriteContentIds,
}: SearchResultsProps) {
  void focusedResultKey;
  void emphasized;

  return (
    <View style={styles.list}>
      {header}
      {results.map((result, index) => (
        <ResultRow
          key={searchResultKey(result)}
          result={result}
          index={index}
          focusUpHandle={focusUpHandle}
          focusLeftHandle={focusLeftHandle}
          firstRowRef={firstRowRef}
          restoreResultKey={restoreResultKey}
          restoreRowRef={restoreRowRef}
          favoriteContentIds={favoriteContentIds}
          onFocusResult={onFocusResult}
          onSelectResult={onSelectResult}
        />
      ))}
    </View>
  );
}

function FollowFocusSearchResults({
  results,
  focusedResultKey,
  onFocusResult,
  onSelectResult,
  header,
  focusUpHandle,
  focusLeftHandle,
  firstRowRef,
  restoreResultKey,
  restoreRowRef,
  favoriteContentIds,
  onEndReached,
  queryLength = 0,
  overlayVisible = true,
}: SearchResultsProps) {
  const listRef = useRef<FlatList<SearchResult>>(null);
  const visibleRangeRef = useRef<{ first: number; last: number } | null>(null);
  const lastScrolledIndexRef = useRef<number | null>(null);

  const applyScrollPlan = useCallback(
    (plan: LiveSearchFocusScrollPlan, source: string, channelId: string | null) => {
      if (plan.action !== 'scroll') {
        return;
      }
      if (lastScrolledIndexRef.current === plan.index) {
        return;
      }
      lastScrolledIndexRef.current = plan.index;
      logLiveSearchFocus({
        event: source === 'restore' ? 'result-restore-scroll' : 'result-scroll-request',
        channelId,
        resultIndex: plan.index,
        visibleStartIndex: visibleRangeRef.current?.first ?? null,
        visibleEndIndex: visibleRangeRef.current?.last ?? null,
        queryLength,
        overlayVisible,
        source,
      });
      try {
        listRef.current?.scrollToIndex({
          index: plan.index,
          animated: false,
          viewPosition: plan.viewPosition,
        });
        logLiveSearchFocus({
          event: 'result-scroll-confirmed',
          channelId,
          resultIndex: plan.index,
          visibleStartIndex: visibleRangeRef.current?.first ?? null,
          visibleEndIndex: visibleRangeRef.current?.last ?? null,
          queryLength,
          overlayVisible,
          source,
        });
      } catch {
        logLiveSearchFocus({
          event: 'result-scroll-failed',
          channelId,
          resultIndex: plan.index,
          queryLength,
          overlayVisible,
          source: `${source}:threw`,
        });
      }
    },
    [overlayVisible, queryLength],
  );

  const handleResultFocus = useCallback(
    (key: string, index: number, channelId: string) => {
      onFocusResult?.(key);
      logLiveSearchFocus({
        event: 'result-focus',
        channelId,
        resultIndex: index,
        visibleStartIndex: visibleRangeRef.current?.first ?? null,
        visibleEndIndex: visibleRangeRef.current?.last ?? null,
        queryLength,
        overlayVisible,
        source: 'result-onFocus',
      });
      const plan = planLiveSearchFocusScroll({
        focusedIndex: index,
        visible: visibleRangeRef.current,
        totalCount: results.length,
        reason: 'focus',
      });
      applyScrollPlan(plan, 'focus', channelId);
    },
    [applyScrollPlan, onFocusResult, overlayVisible, queryLength, results.length],
  );

  useEffect(() => {
    lastScrolledIndexRef.current = null;
  }, [results]);

  useEffect(() => {
    if (!restoreResultKey) {
      return;
    }
    const restoreIndex = results.findIndex((result) => searchResultKey(result) === restoreResultKey);
    if (restoreIndex < 0) {
      return;
    }
    const channelId = results[restoreIndex]?.id ?? null;
    logLiveSearchFocus({
      event: 'result-restore-focus',
      channelId,
      resultIndex: restoreIndex,
      visibleStartIndex: visibleRangeRef.current?.first ?? null,
      visibleEndIndex: visibleRangeRef.current?.last ?? null,
      queryLength,
      overlayVisible,
      source: 'restoreResultKey',
    });
    const plan = planLiveSearchFocusScroll({
      focusedIndex: restoreIndex,
      visible: visibleRangeRef.current,
      totalCount: results.length,
      reason: 'restore',
    });
    applyScrollPlan(plan, 'restore', channelId);
  }, [applyScrollPlan, overlayVisible, queryLength, restoreResultKey, results]);

  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    visibleRangeRef.current = visibleRangeFromViewableItems(viewableItems);
  }, []);

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<SearchResult>) => {
      const key = searchResultKey(item);
      return (
        <ResultRow
          result={item}
          index={index}
          focusUpHandle={focusUpHandle}
          focusLeftHandle={focusLeftHandle}
          firstRowRef={firstRowRef}
          restoreResultKey={restoreResultKey}
          restoreRowRef={restoreRowRef}
          favoriteContentIds={favoriteContentIds}
          onFocusResult={() => handleResultFocus(key, index, item.id)}
          onSelectResult={onSelectResult}
        />
      );
    },
    [
      favoriteContentIds,
      firstRowRef,
      focusLeftHandle,
      focusUpHandle,
      handleResultFocus,
      onSelectResult,
      restoreResultKey,
      restoreRowRef,
    ],
  );

  return (
    <FlatList
      ref={listRef}
      style={styles.followList}
      data={results}
      keyExtractor={(item) => searchResultKey(item)}
      extraData={`${focusedResultKey ?? ''}:${restoreResultKey ?? ''}`}
      renderItem={renderItem}
      ListHeaderComponent={header ? <>{header}</> : null}
      getItemLayout={(_item, index) => liveSearchResultItemLayout(index)}
      initialNumToRender={12}
      maxToRenderPerBatch={8}
      windowSize={8}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.4}
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={VIEWABILITY_CONFIG}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      onScrollToIndexFailed={(info) => {
        const fallback = planLiveSearchScrollToIndexFailedFallback({
          index: info.index,
          averageItemLength: info.averageItemLength || LIVE_SEARCH_RESULT_ROW_HEIGHT,
        });
        logLiveSearchFocus({
          event: 'result-scroll-failed',
          resultIndex: info.index,
          queryLength,
          overlayVisible,
          source: 'onScrollToIndexFailed',
        });
        listRef.current?.scrollToOffset({ offset: fallback.offset, animated: false });
        requestAnimationFrame(() => {
          try {
            listRef.current?.scrollToIndex({
              index: fallback.retryIndex,
              animated: false,
              viewPosition: LIVE_SEARCH_FOCUS_SCROLL_VIEW_POSITION,
            });
            lastScrolledIndexRef.current = fallback.retryIndex;
            logLiveSearchFocus({
              event: 'result-scroll-confirmed',
              resultIndex: fallback.retryIndex,
              queryLength,
              overlayVisible,
              source: 'onScrollToIndexFailed-retry',
            });
          } catch {
            logLiveSearchFocus({
              event: 'result-scroll-failed',
              resultIndex: fallback.retryIndex,
              queryLength,
              overlayVisible,
              source: 'onScrollToIndexFailed-retry-threw',
            });
          }
        });
      }}
    />
  );
}

const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 60 };

export function SearchResults(props: SearchResultsProps) {
  if (props.followFocusedResult) {
    return <FollowFocusSearchResults {...props} />;
  }

  return <StaticSearchResults {...props} />;
}

const styles = StyleSheet.create({
  list: {
    paddingBottom: 8,
  },
  followList: {
    flex: 1,
    minHeight: 0,
  },
  liveLogo: {
    width: 28,
    height: 28,
    marginRight: 8,
  },
});
