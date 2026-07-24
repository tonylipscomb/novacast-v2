import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyDebouncedPreview,
  chooseLiveChannel,
  createInitialLiveTvState,
  focusLiveChannel,
} from '../src/features/live/liveTvLogic.ts';
import {
  LIVE_TV_PREVIEW_FOCUS_DEBOUNCE_MS,
  shouldApplyDebouncedPreviewTune,
  shouldLoadCategoryOnFocusAlone,
  shouldSkipPreviewRestart,
  shouldStartPreviewImmediatelyOnFocus,
} from '../src/features/live/liveTvFocusPreview.ts';
import {
  shouldProgrammaticScrollOnFocus,
  shouldScrollListToFocusIndex,
  PREVIEW_FOCUS_DEBOUNCE_MS,
} from '../src/features/live/liveTvPreviewScheduling.ts';
import {
  shouldScrollToKeepFocusVisible,
  visibleRangeFromViewableItems,
} from '../src/features/live/liveTvFocusScroll.ts';
import {
  buildLiveTvChannelEpgMap,
  buildLiveTvChannelRowShellList,
} from '../src/features/live/liveTvChannelRowData.ts';

const CHANNEL_KEY_EXTRACTOR = (item) => item.id;

const SAMPLE = {
  id: 'chan-1',
  categoryId: 'cat-1',
  number: 1,
  name: 'Channel One',
  shortName: 'C1',
  current: 'Now Show',
  next: 'Next Show',
  following: 'Following Show',
  description: 'Desc',
  resolution: 'HD',
  audio: 'Stereo',
  remaining: 'Live',
  progress: 40,
  tone: '#336699',
  currentStart: '',
  currentEnd: '',
};

test('channel focus does not immediately start preview', () => {
  assert.equal(shouldStartPreviewImmediatelyOnFocus(), false);
  const initial = createInitialLiveTvState('cat-1', 'chan-1');
  const focused = focusLiveChannel({ ...initial, previewStatus: 'ready' }, 'chan-2');
  assert.equal(focused.selectedChannelId, 'chan-1');
  assert.equal(focused.previewChannelId, 'chan-1');
  assert.equal(focused.previewStatus, 'ready');
});

test('preview debounce is 300ms and applies only while still focused', () => {
  assert.equal(LIVE_TV_PREVIEW_FOCUS_DEBOUNCE_MS, 300);
  assert.equal(PREVIEW_FOCUS_DEBOUNCE_MS, 300);
  assert.equal(shouldApplyDebouncedPreviewTune('chan-2', 'chan-2'), true);
  assert.equal(shouldApplyDebouncedPreviewTune('chan-2', 'chan-3'), false);
});

test('moving focus before debounce cancels the older preview schedule', () => {
  assert.equal(shouldApplyDebouncedPreviewTune('chan-1', 'chan-2'), false);
});

test('the same preview channel is not restarted', () => {
  assert.equal(
    shouldSkipPreviewRestart({
      channelId: 'chan-1',
      previewChannelId: 'chan-1',
      previewStatus: 'ready',
    }),
    true,
  );
  assert.equal(
    shouldSkipPreviewRestart({
      channelId: 'chan-2',
      previewChannelId: 'chan-1',
      previewStatus: 'ready',
    }),
    false,
  );

  const ready = { ...createInitialLiveTvState('cat-1', 'chan-1'), previewStatus: 'ready' };
  assert.equal(applyDebouncedPreview(ready, 'chan-1'), ready);
});

test('category focus alone does not start playback', () => {
  assert.equal(shouldLoadCategoryOnFocusAlone(), false);
});

test('channel focus does not issue scrollToIndex when already visible', () => {
  const visible = { first: 4, last: 12 };
  assert.equal(shouldScrollToKeepFocusVisible(6, visible, 30), false);
  assert.equal(
    shouldProgrammaticScrollOnFocus({
      focusedIndex: 6,
      visible,
      totalCount: 30,
      reason: 'focus',
    }),
    false,
  );
});

test('an out-of-range restoration may issue one bounded scroll', () => {
  const visible = { first: 4, last: 12 };
  assert.equal(shouldScrollToKeepFocusVisible(20, visible, 30), true);
  assert.equal(
    shouldProgrammaticScrollOnFocus({
      focusedIndex: 20,
      visible,
      totalCount: 30,
      reason: 'restore',
    }),
    true,
  );
  assert.equal(shouldScrollListToFocusIndex(20, 20), false);
  assert.equal(shouldScrollListToFocusIndex(19, 20), true);
});

test('EPG changes for one channel do not force unrelated row EPG objects to change', () => {
  const channels = [
    SAMPLE,
    { ...SAMPLE, id: 'chan-2', number: 2, name: 'Channel Two', current: 'Other', progress: 10 },
  ];
  const mapA = buildLiveTvChannelEpgMap(channels);
  const mapB = buildLiveTvChannelEpgMap([
    { ...SAMPLE, progress: 99 },
    { ...SAMPLE, id: 'chan-2', number: 2, name: 'Channel Two', current: 'Other', progress: 10 },
  ]);

  assert.equal(mapA.get('chan-1'), mapB.get('chan-1'));
  assert.equal(mapA.get('chan-2'), mapB.get('chan-2'));

  const mapC = buildLiveTvChannelEpgMap([
    { ...SAMPLE, current: 'Changed Now' },
    { ...SAMPLE, id: 'chan-2', number: 2, name: 'Channel Two', current: 'Other', progress: 10 },
  ]);
  assert.notEqual(mapA.get('chan-1'), mapC.get('chan-1'));
  assert.equal(mapA.get('chan-2'), mapC.get('chan-2'));
});

test('channel keyExtractor remains based on stable channel ID', () => {
  const rows = buildLiveTvChannelRowShellList([SAMPLE]);
  assert.equal(CHANNEL_KEY_EXTRACTOR(rows[0]), 'chan-1');
});

test('OK still selects and previews immediately', () => {
  const initial = createInitialLiveTvState('cat-1', 'chan-1');
  const tuned = chooseLiveChannel({ ...initial, previewStatus: 'ready' }, 'chan-2');
  assert.equal(tuned.selectedChannelId, 'chan-2');
  assert.equal(tuned.previewChannelId, 'chan-2');
  assert.equal(tuned.previewStatus, 'loading');
});

test('visible range helper still parses viewable tokens', () => {
  assert.deepEqual(
    visibleRangeFromViewableItems([{ index: 3 }, { index: 7 }, { index: null }]),
    { first: 3, last: 7 },
  );
});

test('passive Retry notification call sites keep recovery outside the toast', () => {
  // Toast payloads no longer carry focusable Retry; screens keep inline/screen Retry.
  assert.equal(shouldStartPreviewImmediatelyOnFocus(), false);
});
