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
import { shouldScrollListToFocusIndex } from './liveTvPreviewScheduling';
import { recordLiveTvManualScroll } from './liveTvScrollPerf';
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

  const epgSignature = useMemo(
    () => channels.map((channel) => `${channel.id}:${channel.current ?? ''}:${channel.progress ?? 0}`).join('|'),
    [channels],
  );

  const listExtraData = useMemo(
    () =>
      `${resolveLiveTvRowAbMode()}:${selectedChannelId}:${previewChannelId ?? ''}:${categoryFocusLeftHandle ?? ''}:${epgSignature}`,
    [categoryFocusLeftHandle, epgSignature, previewChannelId, selectedChannelId],
  );

  const scrollToFocusedIndex = useCallback(
    (nextIndex: number) => {
      if (!shouldScrollListToFocusIndex(lastScrolledIndexRef.current, nextIndex)) {
        return;
      }

      if (!shouldScrollToKeepFocusVisible(nextIndex, visibleRangeRef.current, rowShells.length)) {
        return;
      }

      recordLiveTvManualScroll();
      lastScrolledIndexRef.current = nextIndex;
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
      scrollToFocusedIndex(nextIndex);
    },
    [channelIndexById, onFocus, scrollToFocusedIndex],
  );

  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    visibleRangeRef.current = visibleRangeFromViewableItems(viewableItems);
  }, []);

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<LiveTvChannelRowShellData>) => {
      const epg = epgByChannelId.get(item.id) ?? { current: '', progress: 0 };

      return (
        <LiveTvChannelRow
          data={item}
          epg={epg}
          selected={item.id === selectedChannelId}
          previewing={item.id === previewChannelId}
          preferFocus={preferFocusChannelId === item.id}
          trapFocusUp={index === 0}
          trapFocusDown={index === rowShells.length - 1}
          nextFocusLeft={categoryFocusLeftHandle}
          onFocus={handleChannelFocus}
          onTune={onTune}
          registerRef={onRegister}
        />
      );
    },
    [
      categoryFocusLeftHandle,
      epgByChannelId,
      handleChannelFocus,
      onRegister,
      onTune,
      preferFocusChannelId,
      previewChannelId,
      rowShells.length,
      selectedChannelId,
    ],
  );

  const onScrollToIndexFailed = useCallback(
    (info: { averageItemLength: number; index: number }) => {
      recordLiveTvManualScroll();
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
      windowSize={7}
      maxToRenderPerBatch={8}
      updateCellsBatchingPeriod={50}
      initialNumToRender={12}
      getItemLayout={getLiveTvChannelItemLayout}
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={VIEWABILITY_CONFIG}
      onScrollToIndexFailed={onScrollToIndexFailed}
      renderItem={renderItem}
    />
  );
});

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
