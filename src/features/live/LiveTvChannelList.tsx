import type { ElementRef, RefObject } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { findNodeHandle, FlatList, StyleSheet, type LayoutChangeEvent, type ListRenderItemInfo, type ViewToken } from 'react-native';
import { View } from 'react-native';

import type { ProviderLiveChannel } from '@/features/providers/providerRepositories';

import { LiveTvChannelRow } from './LiveTvChannelRow';
import {
  buildLiveTvChannelRowShellList,
  type LiveTvChannelEpgData,
  type LiveTvChannelRowShellData,
} from './liveTvChannelRowData';
import {
  visibleRangeFromViewableItems,
  type VisibleIndexRange,
} from './liveTvFocusScroll';
import { getLiveTvChannelItemLayout } from './liveTvChannelRowLayout';
import { recordLiveTvManualScroll } from './liveTvScrollPerf';
import { recordLiveTvProgrammaticScroll, recordLiveTvVisibleRowRender } from './liveTvFocusDiagnostics';
import { resolveLiveTvRowAbMode } from './liveTvUiPerfMode';
import { logLiveNavPerf } from './liveTvDiagnostics';

const CHANNEL_KEY_EXTRACTOR = (item: LiveTvChannelRowShellData) => item.id;

const VIEWABILITY_CONFIG = {
  itemVisiblePercentThreshold: 40,
  minimumViewTime: 0,
};

type LiveTvChannelListProps = {
  channels: ProviderLiveChannel[];
  epgByChannelId: ReadonlyMap<string, LiveTvChannelEpgData>;
  epgRevision: number;
  categoryId?: string | null;
  epgPendingChannelIds: ReadonlySet<string>;
  selectedChannelId: string;
  previewChannelId: string | null;
  preferFocusChannelId: string | null;
  listRef: RefObject<FlatList<LiveTvChannelRowShellData> | null>;
  categoryFocusLeftHandle?: number;
  favoriteChannelIds: ReadonlySet<string>;
  onFavoriteChannel: (channelId: string) => void;
  onPlayChannel: (channelId: string) => void;
  playEnabled: boolean;
  registerFavoriteActionRef?: (channelId: string, instance: ElementRef<typeof View> | null) => void;
  registerPlayActionRef?: (channelId: string, instance: ElementRef<typeof View> | null) => void;
  consumeFavoriteHoldSuppression?: (channelId: string) => boolean;
  onActionFocusChange?: (channelId: string, focused: boolean) => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  onFocusRenderState?: (state: {
    focusedIndex: number;
    bandFirst: number;
    bandLast: number;
    visibleRange: VisibleIndexRange | null;
  }) => void;
  getLastNavigationIntent?: () => string;
  onTuneChannel: (channelId: string) => void;
  onChannelFocus: (channelId: string) => void;
  registerRowRef: (channelId: string, instance: ElementRef<typeof View> | null) => void;
};

export const LiveTvChannelList = memo(function LiveTvChannelList({
  channels,
  epgByChannelId,
  epgRevision,
  categoryId,
  epgPendingChannelIds,
  selectedChannelId,
  previewChannelId,
  preferFocusChannelId,
  listRef,
  categoryFocusLeftHandle,
  favoriteChannelIds,
  onFavoriteChannel,
  onPlayChannel,
  playEnabled,
  registerFavoriteActionRef,
  registerPlayActionRef,
  consumeFavoriteHoldSuppression,
  onActionFocusChange,
  onLayout,
  onFocusRenderState,
  getLastNavigationIntent,
  onTuneChannel,
  onChannelFocus,
  registerRowRef,
}: LiveTvChannelListProps) {
  const renderVersionRef = useRef(0);
  renderVersionRef.current += 1;
  const tuneRef = useRef(onTuneChannel);
  const registerRef = useRef(registerRowRef);
  const focusRef = useRef(onChannelFocus);
  useEffect(() => {
    tuneRef.current = onTuneChannel;
    registerRef.current = registerRowRef;
    focusRef.current = onChannelFocus;
  }, [onChannelFocus, onTuneChannel, registerRowRef]);

  const visibleRangeRef = useRef<VisibleIndexRange | null>(null);
  const lastValidVisibleRangeRef = useRef<VisibleIndexRange | null>(null);
  const lastValidVisibleRangeAtRef = useRef(0);
  const focusRenderBandRef = useRef<{ first: number; last: number } | null>(null);
  const focusedIndexRef = useRef<number | null>(null);
  const mountedRowRefsRef = useRef<Map<string, { index: number; handle: number; instance: ElementRef<typeof View> }>>(new Map());
  const nativeRefLogRef = useRef<Map<string, number>>(new Map());
  const scrollRetryRef = useRef<{ index: number; attempts: number } | null>(null);

  const onTune = useMemo(
    () => (channelId: string) => {
      tuneRef.current(channelId);
    },
    [],
  );

  const onRegister = useMemo(
    () => (channelId: string, instance: ElementRef<typeof View> | null) => {
      registerRef.current(channelId, instance);
    },
    [],
  );

  const onFocus = useMemo(
    () => (channelId: string) => {
      focusRef.current(channelId);
    },
    [],
  );

  const rowShells = useMemo(() => buildLiveTvChannelRowShellList(channels), [channels]);
  const channelIndexById = useMemo(() => new Map(rowShells.map((row, index) => [row.id, index])), [rowShells]);

  const applyNativeFocusGraph = useCallback((entry: { index: number; handle: number; instance: ElementRef<typeof View> }) => {
    const previous = Array.from(mountedRowRefsRef.current.values()).find((candidate) => candidate.index === entry.index - 1);
    const next = Array.from(mountedRowRefsRef.current.values()).find((candidate) => candidate.index === entry.index + 1);
    (entry.instance as unknown as { setNativeProps?: (props: object) => void }).setNativeProps?.({
      nextFocusUp: previous?.handle ?? entry.handle,
      nextFocusDown: next?.handle ?? entry.handle,
      nextFocusRight: entry.handle,
    });
  }, []);

  const refreshNativeFocusGraphAround = useCallback((index: number) => {
    for (const entry of mountedRowRefsRef.current.values()) {
      if (Math.abs(entry.index - index) <= 1) {
        applyNativeFocusGraph(entry);
      }
    }
  }, [applyNativeFocusGraph]);

  const registerMountedRowRef = useCallback((channelId: string, instance: ElementRef<typeof View> | null) => {
    const index = channelIndexById.get(channelId);
    if (index === undefined) {
      onRegister(channelId, instance);
      return;
    }
    if (instance) {
      const handle = findNodeHandle(instance);
      if (handle == null) {
        onRegister(channelId, instance);
        const focusedIndex = focusedIndexRef.current;
        logLiveNavPerf('channel-native-ref', {
          categoryId,
          channelId,
          index,
          focusedChannelId: focusedIndex == null ? null : rowShells[focusedIndex]?.id ?? null,
          focusedIndex,
          distanceFromFocusedIndex: focusedIndex == null ? null : Math.abs(index - focusedIndex),
          previousHandlePresent: Boolean(mountedRowRefsRef.current.get(rowShells[index - 1]?.id ?? '')),
          nextHandlePresent: Boolean(mountedRowRefsRef.current.get(rowShells[index + 1]?.id ?? '')),
          selectedChannelId,
          rowMounted: true,
          nativeRefPresent: false,
          listKey: CHANNEL_KEY_EXTRACTOR(rowShells[index]),
          lastNavigationIntent: getLastNavigationIntent?.() ?? 'none',
          timestamp: Date.now(),
          currentVisibleRange: visibleRangeRef.current,
          bandFirst: focusRenderBandRef.current?.first ?? null,
          bandLast: focusRenderBandRef.current?.last ?? null,
          action: 'mount',
        });
        return;
      }
      mountedRowRefsRef.current.set(channelId, { index, handle, instance });
      onRegister(channelId, instance);
      applyNativeFocusGraph({ index, handle, instance });
      refreshNativeFocusGraphAround(index);
      const focusedIndex = focusedIndexRef.current;
      if (focusedIndex != null && Math.abs(index - focusedIndex) <= 3) {
        const now = Date.now();
        const logKey = `${channelId}:mount`;
        if (now - (nativeRefLogRef.current.get(logKey) ?? 0) > 500) {
          nativeRefLogRef.current.set(logKey, now);
          logLiveNavPerf('channel-native-ref', {
            categoryId,
            channelId,
            index,
            focusedChannelId: rowShells[focusedIndex]?.id ?? null,
            focusedIndex,
            distanceFromFocusedIndex: Math.abs(index - focusedIndex),
            previousHandlePresent: Boolean(mountedRowRefsRef.current.get(rowShells[index - 1]?.id ?? '')),
            nextHandlePresent: Boolean(mountedRowRefsRef.current.get(rowShells[index + 1]?.id ?? '')),
            selectedChannelId,
            rowMounted: true,
            nativeRefPresent: true,
            listKey: CHANNEL_KEY_EXTRACTOR(rowShells[index]),
            lastNavigationIntent: getLastNavigationIntent?.() ?? 'none',
            timestamp: now,
            currentVisibleRange: visibleRangeRef.current,
            bandFirst: focusRenderBandRef.current?.first ?? null,
            bandLast: focusRenderBandRef.current?.last ?? null,
            action: 'mount',
          });
        }
      }
      return;
    }
    mountedRowRefsRef.current.delete(channelId);
    onRegister(channelId, null);
    refreshNativeFocusGraphAround(index);
    const focusedIndex = focusedIndexRef.current;
    if (focusedIndex != null && Math.abs(index - focusedIndex) <= 3) {
      const now = Date.now();
      const logKey = `${channelId}:unmount`;
      if (now - (nativeRefLogRef.current.get(logKey) ?? 0) > 500) {
        nativeRefLogRef.current.set(logKey, now);
        logLiveNavPerf('channel-native-ref', {
          categoryId,
          channelId,
          index,
          focusedChannelId: rowShells[focusedIndex]?.id ?? null,
          focusedIndex,
          distanceFromFocusedIndex: Math.abs(index - focusedIndex),
          previousHandlePresent: Boolean(mountedRowRefsRef.current.get(rowShells[index - 1]?.id ?? '')),
          nextHandlePresent: Boolean(mountedRowRefsRef.current.get(rowShells[index + 1]?.id ?? '')),
          selectedChannelId,
          rowMounted: false,
          nativeRefPresent: false,
          listKey: CHANNEL_KEY_EXTRACTOR(rowShells[index]),
          lastNavigationIntent: getLastNavigationIntent?.() ?? 'none',
          timestamp: now,
          currentVisibleRange: visibleRangeRef.current,
          bandFirst: focusRenderBandRef.current?.first ?? null,
          bandLast: focusRenderBandRef.current?.last ?? null,
          action: 'unmount',
        });
      }
    }
  }, [applyNativeFocusGraph, categoryId, channelIndexById, getLastNavigationIntent, onRegister, refreshNativeFocusGraphAround, rowShells, selectedChannelId]);

  useEffect(() => {
    logLiveNavPerf('channel-list-derived', {
      categoryId,
      channelCount: channels.length,
      renderVersion: renderVersionRef.current,
      reason: 'channel-array-changed',
    });
  }, [categoryId, channels.length, rowShells]);

  // Do not include a full-list EPG signature — per-row EPG props drive memoized updates.
  const listExtraData = useMemo(
    () =>
      `${resolveLiveTvRowAbMode()}:${selectedChannelId}:${previewChannelId ?? ''}:${categoryFocusLeftHandle ?? ''}:${favoriteChannelIds.size}:${epgRevision}`,
    [categoryFocusLeftHandle, epgRevision, favoriteChannelIds.size, previewChannelId, selectedChannelId],
  );

  const handleChannelFocus = useCallback(
    (channelId: string) => {
      onFocus(channelId);
      const focusedIndex = channelIndexById.get(channelId);
      focusedIndexRef.current = focusedIndex ?? null;
      if (focusedIndex !== undefined) {
        const currentBand = focusRenderBandRef.current;
        const needsRecenter =
          !currentBand || focusedIndex < currentBand.first + 8 || focusedIndex > currentBand.last - 8;
        const nextBand = needsRecenter
          ? {
              first: Math.max(0, focusedIndex - 16),
              last: Math.min(rowShells.length - 1, focusedIndex + 16),
            }
          : currentBand;
        if (needsRecenter && nextBand) {
          focusRenderBandRef.current = nextBand;
          logLiveNavPerf('focus-render-band', {
            categoryId,
            focusedIndex,
            bandFirst: nextBand.first,
            bandLast: nextBand.last,
            totalChannelCount: rowShells.length,
            reason: currentBand ? 'edge-recenter' : 'initial',
          });
        }
        onFocusRenderState?.({
          focusedIndex,
          bandFirst: nextBand?.first ?? focusedIndex,
          bandLast: nextBand?.last ?? focusedIndex,
          visibleRange: visibleRangeRef.current,
        });
      }
    },
    [categoryId, channelIndexById, onFocus, onFocusRenderState, rowShells.length],
  );

  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const nextVisibleRange = visibleRangeFromViewableItems(viewableItems);
    const now = Date.now();
    visibleRangeRef.current = nextVisibleRange;
    if (nextVisibleRange) {
      lastValidVisibleRangeRef.current = nextVisibleRange;
      lastValidVisibleRangeAtRef.current = now;
    }
    logLiveNavPerf('visible-channel-list-change', {
      categoryId,
      channelCount: rowShells.length,
      visibleRowCount: viewableItems.length,
      renderVersion: renderVersionRef.current,
      reason: 'viewability-change',
    });
  }, [categoryId, rowShells.length]);

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<LiveTvChannelRowShellData>) => {
      recordLiveTvVisibleRowRender();
      const epg = epgByChannelId.get(item.id) ?? { current: '', progress: 0 };

      return (
        <LiveTvChannelRow
          data={item}
          epg={epg}
          epgPending={epgPendingChannelIds.has(item.id)}
          selected={item.id === selectedChannelId}
          previewing={item.id === previewChannelId}
          preferFocus={preferFocusChannelId === item.id}
          trapFocusUp={index === 0}
          trapFocusDown={index === rowShells.length - 1}
          trapFocusRight
        nextFocusLeft={categoryFocusLeftHandle}
        nextFocusRight={undefined}
          isFavorite={favoriteChannelIds.has(item.id)}
          onFavorite={onFavoriteChannel}
          onPlay={onPlayChannel}
          playEnabled={playEnabled}
          registerFavoriteActionRef={registerFavoriteActionRef}
          registerPlayActionRef={registerPlayActionRef}
          consumeFavoriteHoldSuppression={consumeFavoriteHoldSuppression}
          onActionFocusChange={onActionFocusChange}
          onFocus={handleChannelFocus}
          onTune={onTune}
          registerRef={registerMountedRowRef}
        />
      );
    },
    [
      categoryFocusLeftHandle,
      favoriteChannelIds,
      epgByChannelId,
      epgPendingChannelIds,
      handleChannelFocus,
      registerMountedRowRef,
      onRegister,
      onTune,
      onFavoriteChannel,
      onPlayChannel,
      playEnabled,
      registerFavoriteActionRef,
      registerPlayActionRef,
      consumeFavoriteHoldSuppression,
      onActionFocusChange,
      preferFocusChannelId,
      previewChannelId,
      rowShells.length,
      selectedChannelId,
    ],
  );

  const onScrollToIndexFailed = useCallback(
    (info: { averageItemLength: number; index: number }) => {
      console.warn('[NOVACAST_FOCUS]', 'scroll-to-index-failed', {
        categoryId,
        index: info.index,
        averageItemLength: info.averageItemLength,
      });
      const retry = scrollRetryRef.current;
      if (retry && retry.index === info.index && retry.attempts >= 1) {
        scrollRetryRef.current = null;
        return;
      }

      scrollRetryRef.current = { index: info.index, attempts: (retry?.attempts ?? 0) + 1 };
      recordLiveTvManualScroll();
      recordLiveTvProgrammaticScroll('focus-recovery');
      listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
    },
    [categoryId, listRef],
  );

  return (
    <FlatList
      ref={listRef}
      style={styles.list}
      data={rowShells}
      extraData={listExtraData}
      keyExtractor={CHANNEL_KEY_EXTRACTOR}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.channelList}
      removeClippedSubviews={false}
      windowSize={11}
      maxToRenderPerBatch={10}
      updateCellsBatchingPeriod={40}
      initialNumToRender={16}
      getItemLayout={getLiveTvChannelItemLayout}
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={VIEWABILITY_CONFIG}
      onScrollToIndexFailed={onScrollToIndexFailed}
      renderItem={renderItem}
      onLayout={(event) => {
        logLiveNavPerf('channel-list-render-ready', {
          categoryId,
          channelCount: rowShells.length,
          visibleRowCount: visibleRangeRef.current ? visibleRangeRef.current.last - visibleRangeRef.current.first + 1 : null,
          renderVersion: renderVersionRef.current,
          reason: 'layout-ready',
        });
        onLayout?.(event);
      }}
    />
  );
});

export { CHANNEL_KEY_EXTRACTOR as liveTvChannelKeyExtractor };

const styles = StyleSheet.create({
  list: {
    flex: 1,
    minHeight: 0,
  },
  channelList: {
    gap: 3,
    paddingTop: 4,
    paddingBottom: 8,
  },
});
