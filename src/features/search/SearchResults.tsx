import type { RefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import {
  FlatList,
  findNodeHandle,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
  type View as ViewType,
  type ViewToken,
} from 'react-native';

import { NovaFocusRow } from '@/components/nova/NovaFocusRow';
import { displayStreamTitle } from '@/features/series/metadata/titleNormalization';
import { novaTheme } from '@/theme';
import { createFavoriteHoldDetector } from '@/features/live/liveFavoriteHold';
import { NOVA_GLASS } from '@/components/nova/novaGlassTheme';

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
  onToggleLiveFavorite?: (result: LiveSearchResult) => void;
  onFocusLiveResult?: (result: LiveSearchResult | null) => void;
  consumeLiveFavoriteHoldSuppression?: (id: string) => boolean;
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
  onToggleLiveFavorite,
  onFocusLiveResult,
  consumeLiveFavoriteHoldSuppression,
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
  onToggleLiveFavorite?: (result: LiveSearchResult) => void;
  onFocusLiveResult?: (result: LiveSearchResult | null) => void;
  consumeLiveFavoriteHoldSuppression?: (id: string) => boolean;
}) {
  const key = searchResultKey(result);
  const isLive = result.type === 'live';
  const [isFocused, setIsFocused] = useState(false);
  const nativeRef =
    restoreResultKey && key === restoreResultKey ? restoreRowRef : index === 0 ? firstRowRef : undefined;

  if (isLive) {
    return (
      <LiveSearchResultRow
        result={result}
        isFavorite={Boolean(favoriteContentIds?.has(result.id))}
        isRestoreTarget={Boolean(restoreResultKey && key === restoreResultKey)}
        nativeRef={nativeRef}
        focusUpHandle={index === 0 ? focusUpHandle : undefined}
        focusLeftHandle={index === 0 ? focusLeftHandle : undefined}
        onFocusResult={onFocusResult}
        onSelectResult={onSelectResult}
        onToggleFavorite={onToggleLiveFavorite}
        onFocusLiveResult={onFocusLiveResult}
        consumeLiveFavoriteHoldSuppression={consumeLiveFavoriteHoldSuppression}
      />
    );
  }

  return (
    <NovaFocusRow
      title={displayStreamTitle(result.title)}
      subtitle={subtitleForResult(result)}
      meta={kindLabel(result.type)}
      leading={
        undefined
      }
      nativeRef={nativeRef}
      focusChrome="none"
      nextFocusUp={index === 0 ? focusUpHandle : undefined}
      nextFocusLeft={index === 0 ? focusLeftHandle : undefined}
      onFocus={() => {
        setIsFocused(true);
        onFocusResult?.(key);
        onFocusLiveResult?.(isLive ? result : null);
      }}
      onBlur={() => {
        setIsFocused(false);
      }}
      onPress={() => {
        onSelectResult(result);
      }}
      accessibilityLabel={`Open ${kindLabel(result.type)} ${result.title}`}
      style={[styles.resultRow, isFocused && styles.resultRowFocused]}
      trailing={
        <>
          <MaterialCommunityIcons
            name="chevron-right"
            size={18}
            color={isFocused ? novaTheme.colors.textPrimary : novaTheme.colors.textMuted}
          />
        </>
      }
    />
  );
}

function LiveSearchResultRow({
  result,
  isFavorite,
  isRestoreTarget,
  nativeRef,
  focusUpHandle,
  focusLeftHandle,
  onFocusResult,
  onSelectResult,
  onToggleFavorite,
  onFocusLiveResult,
  consumeLiveFavoriteHoldSuppression,
}: {
  result: LiveSearchResult;
  isFavorite: boolean;
  isRestoreTarget: boolean;
  nativeRef?: RefObject<ViewType | null>;
  focusUpHandle?: number;
  focusLeftHandle?: number;
  onFocusResult?: (key: string) => void;
  onSelectResult: (result: SearchResult) => void;
  onToggleFavorite?: (result: LiveSearchResult) => void;
  onFocusLiveResult?: (result: LiveSearchResult | null) => void;
  consumeLiveFavoriteHoldSuppression?: (id: string) => boolean;
}) {
  const key = searchResultKey(result);
  const rowRef = useRef<ViewType | null>(null);
  const favoriteRef = useRef<ViewType | null>(null);
  const [rowHandle, setRowHandle] = useState<number | undefined>();
  const [favoriteHandle, setFavoriteHandle] = useState<number | undefined>();
  const [rowFocused, setRowFocused] = useState(false);
  const [favoriteFocused, setFavoriteFocused] = useState(false);
  const favoritePressRef = useRef(false);
  const holdSuppressedRef = useRef(false);
  const nativeTvHold = Platform.OS === 'android' && Platform.isTV === true;
  const favoriteHoldRef = useRef<ReturnType<typeof createFavoriteHoldDetector> | null>(null);

  if (!nativeTvHold && onToggleFavorite && !favoriteHoldRef.current) {
    favoriteHoldRef.current = createFavoriteHoldDetector({
      onTriggered: () => {
        holdSuppressedRef.current = true;
        onToggleFavorite(result);
      },
    });
  }

  const assignRowRef = (instance: ViewType | null) => {
    rowRef.current = instance;
    if (nativeRef) {
      nativeRef.current = instance;
    }
    const handle = instance ? findNodeHandle(instance) ?? undefined : undefined;
    setRowHandle((current) => (current === handle ? current : handle));
  };

  const focused = rowFocused || favoriteFocused;
  const activateFavorite = () => {
    favoritePressRef.current = true;
    onToggleFavorite?.(result);
  };

  return (
    <Pressable
      ref={assignRowRef}
      focusable
      accessible
      accessibilityRole="button"
      accessibilityLabel={`Open Live ${result.title}`}
      hasTVPreferredFocus={isRestoreTarget}
      {...(focusUpHandle ? { nextFocusUp: focusUpHandle } : null)}
      {...(focusLeftHandle ? { nextFocusLeft: focusLeftHandle } : null)}
      {...(favoriteHandle ? { nextFocusRight: favoriteHandle } : null)}
      onFocus={() => {
        setRowFocused(true);
        onFocusResult?.(key);
        onFocusLiveResult?.(result);
      }}
      onBlur={() => {
        setRowFocused(false);
        if (!favoriteFocused) {
          onFocusLiveResult?.(null);
        }
        favoriteHoldRef.current?.cancel('search-row-blur');
      }}
      onPressIn={() => {
        favoritePressRef.current = false;
        if (!nativeTvHold) {
          holdSuppressedRef.current = false;
          favoriteHoldRef.current?.pressIn();
        }
      }}
      onPressOut={() => {
        if (!nativeTvHold) favoriteHoldRef.current?.pressOut();
      }}
      onPress={() => {
        if (favoritePressRef.current) {
          favoritePressRef.current = false;
          return;
        }
        if (holdSuppressedRef.current || consumeLiveFavoriteHoldSuppression?.(result.id)) {
          holdSuppressedRef.current = false;
          return;
        }
        onSelectResult(result);
      }}
      style={[styles.resultRow, focused && styles.resultRowFocused]}>
      {result.logoUrl ? (
        <Image source={{ uri: result.logoUrl }} style={styles.liveLogo} contentFit="contain" />
      ) : null}
      <Text style={[styles.liveMeta, focused && styles.liveMetaFocused]} numberOfLines={1}>
        {liveMeta(result)}
      </Text>
      <View style={styles.liveCopy}>
        <Text style={[styles.liveTitle, focused && styles.liveTitleFocused]} numberOfLines={1}>
          {displayStreamTitle(result.title)}
        </Text>
        <Text style={[styles.liveSubtitle, focused && styles.liveSubtitleFocused]} numberOfLines={1}>
          {liveSubtitle(result)}
        </Text>
      </View>
      <Pressable
        ref={(instance) => {
          favoriteRef.current = instance;
          const handle = instance ? findNodeHandle(instance) ?? undefined : undefined;
          setFavoriteHandle((current) => (current === handle ? current : handle));
        }}
        focusable
        accessible
        accessibilityRole="button"
        accessibilityLabel={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        {...(rowHandle ? { nextFocusLeft: rowHandle } : null)}
        onFocus={() => {
          setFavoriteFocused(true);
          onFocusResult?.(key);
          // The native long-press controller belongs to the row action. Disable
          // it while the dedicated heart has focus so SELECT cannot toggle twice.
          onFocusLiveResult?.(null);
        }}
        onBlur={() => {
          setFavoriteFocused(false);
          onFocusLiveResult?.(null);
        }}
        onPressIn={(event) => {
          event.stopPropagation();
          favoritePressRef.current = true;
        }}
        onPressOut={(event) => event.stopPropagation()}
        onPress={(event) => {
          event.stopPropagation();
          activateFavorite();
        }}
        style={[styles.favoriteAction, favoriteFocused && styles.favoriteActionFocused]}>
        <MaterialCommunityIcons
          name={isFavorite ? 'heart' : 'heart-outline'}
          size={16}
          color={favoriteFocused || focused ? novaTheme.colors.textPrimary : isFavorite ? novaTheme.colors.accentHover : novaTheme.colors.textMuted}
        />
      </Pressable>
      <MaterialCommunityIcons
        name="chevron-right"
        size={18}
        color={focused ? novaTheme.colors.textPrimary : novaTheme.colors.textMuted}
      />
    </Pressable>
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
  onToggleLiveFavorite,
  onFocusLiveResult,
  consumeLiveFavoriteHoldSuppression,
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
          onToggleLiveFavorite={onToggleLiveFavorite}
          onFocusLiveResult={onFocusLiveResult}
          consumeLiveFavoriteHoldSuppression={consumeLiveFavoriteHoldSuppression}
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
  onToggleLiveFavorite,
  onFocusLiveResult,
  consumeLiveFavoriteHoldSuppression,
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
          onToggleLiveFavorite={onToggleLiveFavorite}
          onFocusLiveResult={onFocusLiveResult}
          consumeLiveFavoriteHoldSuppression={consumeLiveFavoriteHoldSuppression}
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
      onToggleLiveFavorite,
      restoreResultKey,
      restoreRowRef,
    ],
  );

  return (
    <FlatList
      ref={listRef}
      style={styles.followList}
      contentContainerStyle={styles.followListContent}
      data={results}
      keyExtractor={(item) => searchResultKey(item)}
      extraData={{ focusedResultKey, restoreResultKey, favoriteContentIds }}
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
    paddingHorizontal: 6,
    paddingTop: 4,
    paddingBottom: 8,
  },
  followList: {
    flex: 1,
    minHeight: 0,
  },
  followListContent: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  liveLogo: {
    width: 28,
    height: 28,
    marginRight: 8,
  },
  resultRow: {
    minHeight: novaTheme.density.rowHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: NOVA_GLASS.subtle.backgroundColor,
    borderColor: NOVA_GLASS.subtle.borderColor,
    borderWidth: 1,
    borderRadius: NOVA_GLASS.radius.base,
    paddingHorizontal: 6,
    paddingVertical: 4,
    marginBottom: 2,
  },
  resultRowFocused: {
    backgroundColor: 'rgba(80,60,180,0.18)',
    borderColor: NOVA_GLASS.active.borderColor,
    borderWidth: 1,
    borderRadius: NOVA_GLASS.radius.base,
    shadowColor: '#7356E8',
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
    transform: [{ scale: 1.01 }],
  },
  liveMeta: {
    minWidth: 54,
    color: novaTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  liveMetaFocused: {
    color: novaTheme.colors.textPrimary,
  },
  liveCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  liveTitle: {
    color: novaTheme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  liveTitleFocused: {
    color: novaTheme.colors.textPrimary,
    fontWeight: '800',
  },
  liveSubtitle: {
    color: novaTheme.colors.textSecondary,
    fontSize: 12,
  },
  liveSubtitleFocused: {
    color: novaTheme.colors.textPrimary,
    fontWeight: '700',
  },
  favoriteAction: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  favoriteActionFocused: {
    backgroundColor: 'rgba(80,60,180,0.18)',
    borderColor: NOVA_GLASS.active.borderColor,
    borderWidth: 1,
    borderRadius: 10,
  },
});
