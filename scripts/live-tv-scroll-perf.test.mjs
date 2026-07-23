import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLiveTvChannelEpgMap,
  buildLiveTvChannelRowShellList,
  mergeLiveTvChannelEpg,
  toLiveTvChannelRowShell,
} from '../src/features/live/liveTvChannelRowData.ts';
import {
  shouldScrollToKeepFocusVisible,
  visibleRangeFromViewableItems,
} from '../src/features/live/liveTvFocusScroll.ts';
import {
  enableLiveTvScrollPerfCountersForTests,
  getLiveTvScrollPerfSnapshot,
  recordLiveTvChannelFocus,
  recordLiveTvChannelTune,
  recordLiveTvManualScroll,
  resetLiveTvScrollPerf,
} from '../src/features/live/liveTvScrollPerf.ts';
import { chooseLiveChannel, createInitialLiveTvState } from '../src/features/live/liveTvLogic.ts';
import { shouldScrollListToFocusIndex } from '../src/features/live/liveTvPreviewScheduling.ts';

const SAMPLE_CHANNEL = {
  id: 'chan-1',
  categoryId: 'cat-1',
  number: 1,
  name: 'Channel One',
  shortName: 'C1',
  current: 'Live',
  next: 'Next',
  following: 'Following',
  description: 'Desc',
  resolution: 'HD',
  audio: 'Stereo',
  remaining: 'Live',
  progress: 40,
  tone: '#336699',
  currentStart: '',
  currentEnd: '',
};

test('Live TV channel row shell keeps only stable list fields', () => {
  const row = toLiveTvChannelRowShell(SAMPLE_CHANNEL);
  assert.deepEqual(Object.keys(row).sort(), ['id', 'logoUrl', 'name', 'number', 'resolution', 'shortName', 'tone']);
  assert.equal(row.id, 'chan-1');
  assert.equal(row.name, 'Channel One');
});

test('Live TV channel row shell list preserves order and one object per channel', () => {
  const rows = buildLiveTvChannelRowShellList([
    SAMPLE_CHANNEL,
    { ...SAMPLE_CHANNEL, id: 'chan-2', number: 2, name: 'Channel Two' },
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.id, 'chan-1');
  assert.equal(rows[1]?.id, 'chan-2');
  assert.notEqual(rows[0], rows[1]);
});

test('Live TV OK press changes preview state but focus-only movement does not', () => {
  const initial = createInitialLiveTvState('cat-1', 'chan-1');
  assert.equal(initial.previewChannelId, 'chan-1');
  assert.equal(initial.previewStatus, 'loading');

  const tuned = chooseLiveChannel(initial, 'chan-2');
  assert.equal(tuned.selectedChannelId, 'chan-2');
  assert.equal(tuned.previewChannelId, 'chan-2');
  assert.equal(tuned.previewStatus, 'loading');
  assert.equal(tuned.previewRequestId, initial.previewRequestId + 1);

  const unchanged = { ...initial, previewStatus: 'ready' };
  assert.equal(unchanged.previewChannelId, 'chan-1');
  assert.equal(unchanged.previewStatus, 'ready');
});

test('Live TV channel row shell preserves object identity when fields are unchanged', () => {
  const rowsA = buildLiveTvChannelRowShellList([SAMPLE_CHANNEL]);
  const rowsB = buildLiveTvChannelRowShellList([SAMPLE_CHANNEL]);
  assert.equal(rowsA[0], rowsB[0]);
});

test('Live TV channel row shell stays stable when only EPG text changes', () => {
  const rowsA = buildLiveTvChannelRowShellList([SAMPLE_CHANNEL]);
  const rowsB = buildLiveTvChannelRowShellList([{ ...SAMPLE_CHANNEL, current: 'Evening News', progress: 72 }]);
  assert.equal(rowsA[0], rowsB[0]);
});

test('Live TV EPG map creates new object when program text changes', () => {
  const epgA = buildLiveTvChannelEpgMap([SAMPLE_CHANNEL]);
  const epgB = buildLiveTvChannelEpgMap([{ ...SAMPLE_CHANNEL, current: 'Evening News', progress: 72 }]);
  assert.notEqual(epgA.get('chan-1'), epgB.get('chan-1'));
  assert.equal(epgB.get('chan-1')?.current, 'Evening News');
});

test('Live TV EPG merge preserves channel object identity when EPG is unchanged', () => {
  const previous = [SAMPLE_CHANNEL];
  const enriched = [{ ...SAMPLE_CHANNEL, current: 'Live' }];
  const merged = mergeLiveTvChannelEpg(previous, enriched);
  assert.equal(merged[0], previous[0]);
});

test('Live TV EPG merge preserves full channel list during incremental enrichment', () => {
  const previous = [
    SAMPLE_CHANNEL,
    { ...SAMPLE_CHANNEL, id: 'chan-2', number: 2 },
    { ...SAMPLE_CHANNEL, id: 'chan-3', number: 3 },
  ];
  const merged = mergeLiveTvChannelEpg(previous, [{ ...SAMPLE_CHANNEL, current: 'Evening News' }]);
  assert.equal(merged.length, 3);
  assert.equal(merged[0]?.current, 'Evening News');
  assert.equal(merged[1], previous[1]);
  assert.equal(merged[2], previous[2]);
});

test('Live TV EPG merge uses full baseline instead of empty interim state', () => {
  const baseline = [
    SAMPLE_CHANNEL,
    { ...SAMPLE_CHANNEL, id: 'chan-2', number: 2 },
  ];
  const merged = mergeLiveTvChannelEpg(baseline, [{ ...SAMPLE_CHANNEL, current: 'Evening News' }]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0]?.current, 'Evening News');
});

test('Live TV EPG merge replaces only channels whose EPG changed', () => {
  const previous = [SAMPLE_CHANNEL, { ...SAMPLE_CHANNEL, id: 'chan-2', number: 2 }];
  const enriched = [
    { ...SAMPLE_CHANNEL, current: 'Evening News' },
    { ...SAMPLE_CHANNEL, id: 'chan-2', number: 2, current: 'Live' },
  ];
  const merged = mergeLiveTvChannelEpg(previous, enriched);
  assert.notEqual(merged[0], previous[0]);
  assert.equal(merged[0]?.current, 'Evening News');
  assert.equal(merged[1], previous[1]);
});

test('Live TV focus scroll only triggers near visible boundaries or offscreen rows', () => {
  const visible = { first: 4, last: 10 };

  assert.equal(shouldScrollToKeepFocusVisible(2, visible, 30), true);
  assert.equal(shouldScrollToKeepFocusVisible(12, visible, 30), true);
  assert.equal(shouldScrollToKeepFocusVisible(9, visible, 30), true);
  assert.equal(shouldScrollToKeepFocusVisible(6, visible, 30), false);
  assert.equal(shouldScrollToKeepFocusVisible(0, visible, 30), true);
});

test('Live TV visible range derives from viewable FlatList tokens', () => {
  assert.deepEqual(
    visibleRangeFromViewableItems([
      { index: 3 },
      { index: 7 },
      { index: null },
    ]),
    { first: 3, last: 7 },
  );
});

test('Live TV scrollToIndex guard skips redundant jumps to the same row', () => {
  assert.equal(shouldScrollListToFocusIndex(4, 4), false);
  assert.equal(shouldScrollListToFocusIndex(4, 5), true);
});

test('Live TV scroll perf counters distinguish focus from tune and manual scroll', () => {
  enableLiveTvScrollPerfCountersForTests();
  resetLiveTvScrollPerf();
  recordLiveTvChannelFocus();
  recordLiveTvChannelFocus();
  recordLiveTvChannelTune();
  recordLiveTvManualScroll();

  const snapshot = getLiveTvScrollPerfSnapshot();
  assert.equal(snapshot.channelFocusEvents, 2);
  assert.equal(snapshot.channelTuneEvents, 1);
  assert.equal(snapshot.manualScrollCalls, 1);
});
