import type { ElementRef, RefObject } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { FlatList, StyleSheet, type ListRenderItemInfo, type ViewToken } from 'react-native';
import { View } from 'react-native';

import type { ProviderLiveChannel } from '@/features/providers/providerRepositories';

import { LiveTvChannelRow } from './LiveTvChannelRow';
import {
  buildLiveTvChannelEpgMap,
  buildLiveTvChannelRowShellList,
  type LiveTvChannelRowShellData,
} from './liveTvChannelRowData';
import {
  LIVE_TV_FOCUS_SCROLL_VIEW_POSITION,
  shouldScrollToKeepFocusVisible,
  visibleRangeFromViewableItems,
  type VisibleIndexRange,
} from './liveTvFocusScroll';
import { getLiveTvChannelItemLayout } from './liveTvChannelRowLayout';
import { shouldProgrammaticScrollOnFocus, shouldScrollListToFocusIndex } from './liveTvPreviewScheduling';
import { recordLiveTvManualScroll } from './liveTvScrollPerf';
import { recordLiveTvProgrammaticScroll, recordLiveTvVisibleRowRender } from './liveTvFocusDiagnostics';
import { resolveLiveTvRowAbMode } from './liveTvUiPerfMode';

const CHANNEL_KEY_EXTRACTOR = (item: LiveTvChannelRowShellData) => item.id;

const VIEWABILITY_CONFIG = {
  itemVisiblePercentThreshold: 40,
  minimumViewTime: 0,
};

type LiveTvChannelListProps = {
  channels: ProviderLiveChannel[];
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
  /** When true, allow one programmatic scroll for restore / category jump. */
  allowRestoreScroll?: boolean;
  onTuneChannel: (channelId: string) => void;
  onChannelFocus: (channelId: string) => void;
  registerRowRef: (channelId: string, instance: ElementRef<typeof View> | null) => void;
};

export const LiveTvChannelList = memo(function LiveTvChannelList({
  channels,
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
  allowRestoreScroll = false,
  onTuneChannel,
  onChannelFocus,
  registerRowRef,
}: LiveTvChannelListProps) {
  const tuneRef = useRef(onTuneChannel);
  const registerRef = useRef(registerRowRef);
  const focusRef = useRef(onChannelFocus);
  useEffect(() => {
    tuneRef.current = onTuneChannel;
    registerRef.current = registerRowRef;
    focusRef.current = onChannelFocus;
  }, [onChannelFocus, onTuneChannel, registerRowRef]);

  const focusedIndexRef = useRef<number | null>(null);
  const visibleRangeRef = useRef<VisibleIndexRange | null>(null);
  const lastScrolledIndexRef = useRef<number | null>(null);
  const scrollRetryRef = useRef<{ index: number; attempts: number } | null>(null);
  const allowRestoreScrollRef = useRef(allowRestoreScroll);
  allowRestoreScrollRef.current = allowRestoreScroll;

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
  const epgByChannelId = useMemo(() => buildLiveTvChannelEpgMap(channels), [channels]);
  const channelIndexById = useMemo(() => new Map(rowShells.map((row, index) => [row.id, index])), [rowShells]);

  // Do not include a full-list EPG signature — per-row EPG props drive memoized updates.
  const listExtraData = useMemo(
    () =>
      `${resolveLiveTvRowAbMode()}:${selectedChannelId}:${previewChannelId ?? ''}:${categoryFocusLeftHandle ?? ''}:${favoriteChannelIds.size}`,
    [categoryFocusLeftHandle, favoriteChannelIds.size, previewChannelId, selectedChannelId],
  );

  const scrollToFocusedIndex = useCallback(
    (nextIndex: number, reason: 'focus' | 'restore' | 'category-jump' | 'focus-recovery') => {
      if (!shouldScrollListToFocusIndex(lastScrolledIndexRef.current, nextIndex)) {
        return;
      }

      const shouldScroll =
        reason !== 'focus'
          ? shouldProgrammaticScrollOnFocus({
              focusedIndex: nextIndex,
              visible: visibleRangeRef.current,
              totalCount: rowShells.length,
              reason,
            })
          : shouldScrollToKeepFocusVisible(nextIndex, visibleRangeRef.current, rowShells.length);

      if (!shouldScroll) {
        return;
      }

      recordLiveTvManualScroll();
      recordLiveTvProgrammaticScroll(reason);
      lastScrolledIndexRef.current = nextIndex;
      scrollRetryRef.current = { index: nextIndex, attempts: 0 };
      listRef.current?.scrollToIndex({
        index: nextIndex,
        animated: false,
        viewPosition: LIVE_TV_FOCUS_SCROLL_VIEW_POSITION,
      });
    },
    [listRef, rowShells.length],
  );

  const handleChannelFocus = useCallback(
    (channelId: string) => {
      onFocus(channelId);
      const nextIndex = channelIndexById.get(channelId);
      if (nextIndex === undefined) {
        return;
      }

      focusedIndexRef.current = nextIndex;
      const reason = allowRestoreScrollRef.current ? 'restore' : 'focus';
      scrollToFocusedIndex(nextIndex, reason);
    },
    [channelIndexById, onFocus, scrollToFocusedIndex],
  );

  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    visibleRangeRef.current = visibleRangeFromViewableItems(viewableItems);
  }, []);

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<LiveTvChannelRowShellData>) => {
      recordLiveTvVisibleRowRender();
      const epg = epgByChannelId.get(item.id) ?? { current: '', progress: 0 };

      return (
        <LiveTvChannelRow
          data={item}
          epg={epg}
          selected={item.id === selectedChannelId}
          previewing={item.id === previewChannelId}
          preferFocus={preferFocusChannelId === item.id}
          trapFocusUp={false}
          trapFocusDown={index === rowShells.length - 1}
        nextFocusLeft={categoryFocusLeftHandle}
        nextFocusRight={undefined}
          isFavorite={favoriteChannelIds.has(item.id)}
          onFavorite={onFavoriteChannel}
          onPlay={onPlayChannel}
          playEnabled={playEnabled}
          registerFavoriteActionRef={registerFavoriteActionRef}
          registerPlayActionRef={registerPlayActionRef}
          onFocus={handleChannelFocus}
          onTune={onTune}
          registerRef={onRegister}
        />
      );
    },
    [
      categoryFocusLeftHandle,
      favoriteChannelIds,
      epgByChannelId,
      handleChannelFocus,
      onRegister,
      onTune,
      onFavoriteChannel,
      onPlayChannel,
      playEnabled,
      registerFavoriteActionRef,
      registerPlayActionRef,
      preferFocusChannelId,
      previewChannelId,
      rowShells.length,
      selectedChannelId,
    ],
  );

  const onScrollToIndexFailed = useCallback(
    (info: { averageItemLength: number; index: number }) => {
      const retry = scrollRetryRef.current;
      if (retry && retry.index === info.index && retry.attempts >= 1) {
        scrollRetryRef.current = null;
        return;
      }

      scrollRetryRef.current = { index: info.index, attempts: (retry?.attempts ?? 0) + 1 };
      recordLiveTvManualScroll();
      recordLiveTvProgrammaticScroll('focus-recovery');
      listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
      lastScrolledIndexRef.current = info.index;
    },
    [listRef],
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
      windowSize={5}
      maxToRenderPerBatch={6}
      updateCellsBatchingPeriod={80}
      initialNumToRender={10}
      getItemLayout={getLiveTvChannelItemLayout}
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={VIEWABILITY_CONFIG}
      onScrollToIndexFailed={onScrollToIndexFailed}
      renderItem={renderItem}
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
