import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chooseLiveChannel,
  closeLiveFullscreen,
  createInitialLiveTvState,
  createLiveTvShellState,
  resolveLivePreview,
  resolveLiveTvNotificationForStatus,
  resolveLiveTvPreviewNotification,
} from '../src/features/live/liveTvLogic.ts';
import {
  createInitialGuideState,
  focusGuideProgram,
  selectGuideProgram,
} from '../src/features/guide/guideLogic.ts';
import { displayLiveProgramText, isRawLiveStreamValue } from '../src/features/live/liveTvProgramText.ts';
import { formatLiveTvCategoryCount } from '../src/features/live/liveTvCategoryCount.ts';

test('Live TV first OK starts preview and second OK enters full screen', () => {
  const initial = createInitialLiveTvState();
  const previewState = chooseLiveChannel(initial, 'entertainment-nova-news');

  assert.equal(previewState.selectedChannelId, 'entertainment-nova-news');
  assert.equal(previewState.previewChannelId, 'entertainment-nova-news');
  assert.equal(previewState.previewStatus, 'loading');

  const readyState = resolveLivePreview(previewState, previewState.previewRequestId, 'entertainment-nova-news', 'ready');
  const fullscreenState = chooseLiveChannel(readyState, 'entertainment-nova-news');

  assert.equal(fullscreenState.fullscreenChannelId, 'entertainment-nova-news');
  assert.equal(fullscreenState.previewChannelId, 'entertainment-nova-news');
});

test('Live TV stale preview requests cannot replace the latest selection', () => {
  const first = chooseLiveChannel(createInitialLiveTvState(), 'entertainment-nova-news');
  const second = chooseLiveChannel(first, 'entertainment-cinema-nova');
  const stale = resolveLivePreview(second, first.previewRequestId, 'entertainment-nova-news', 'ready');

  assert.equal(stale.previewChannelId, 'entertainment-cinema-nova');
  assert.equal(stale.previewStatus, 'loading');

  const resolved = resolveLivePreview(stale, second.previewRequestId, 'entertainment-cinema-nova', 'ready');
  assert.equal(resolved.previewStatus, 'ready');
  assert.equal(resolved.previewChannelId, 'entertainment-cinema-nova');
});

test('Back closes full screen one layer at a time', () => {
  const initial = createInitialLiveTvState();
  const selected = chooseLiveChannel(initial, 'entertainment-nova-news');
  const ready = resolveLivePreview(selected, selected.previewRequestId, 'entertainment-nova-news', 'ready');
  const fullscreen = chooseLiveChannel(ready, 'entertainment-nova-news');
  const closed = closeLiveFullscreen(fullscreen);

  assert.equal(closed.fullscreenChannelId, null);
  assert.equal(closeLiveFullscreen(closed).fullscreenChannelId, null);
});

test('Guide focus only moves focus and does not tune until select', () => {
  const initial = createInitialGuideState();
  const focused = focusGuideProgram(initial, 'm8', 'm8-1');

  assert.equal(focused.focusedChannelId, 'm8');
  assert.equal(focused.focusedProgramId, 'm8-1');
  assert.equal(focused.selectedChannelId, 'n1');
  assert.equal(focused.selectedProgramId, 'n1-0');

  const tuned = selectGuideProgram(focused, 'm8', 'm8-1');
  assert.equal(tuned.selectedChannelId, 'm8');
  assert.equal(tuned.selectedProgramId, 'm8-1');
});

test('Live TV details never display stream URLs or opaque provider tokens', () => {
  const fallback = 'No program information available.';

  assert.equal(isRawLiveStreamValue('https://provider.test/live/123.m3u8?token=secret'), true);
  assert.equal(isRawLiveStreamValue('QjhhcmVseVByb2dyYW1Ub2tlblZhbHVlMTIzNDU2'), true);
  assert.equal(displayLiveProgramText('https://provider.test/live/123.ts', fallback), fallback);
  assert.equal(displayLiveProgramText('', fallback), fallback);
  assert.equal(displayLiveProgramText('Two and a Half Men', fallback), 'Two and a Half Men');
});

test('Live TV category counts use compact right-column labels', () => {
  assert.equal(formatLiveTvCategoryCount(null), '\u2014');
  assert.equal(formatLiveTvCategoryCount(undefined), '\u2014');
  assert.equal(formatLiveTvCategoryCount(0), '0');
  assert.equal(formatLiveTvCategoryCount(214), '214');
});

test('Live TV load notifications only surface recoverable errors', () => {
  assert.equal(resolveLiveTvNotificationForStatus('ready', false), null);
  assert.equal(resolveLiveTvNotificationForStatus('empty', false), null);
  assert.equal(resolveLiveTvNotificationForStatus('loading', false), null);

  const error = resolveLiveTvNotificationForStatus('error', false);
  assert.equal(error?.title, 'Live TV unavailable');
  assert.match(error?.message ?? '', /could not load channels/i);

  const custom = resolveLiveTvNotificationForStatus('error', false, 'Provider timed out.');
  assert.equal(custom?.message, 'Provider timed out.');
  assert.equal(resolveLiveTvNotificationForStatus('error', true)?.persistent, true);
});

test('Live TV preview notifications carry retry persistence and custom copy', () => {
  const preview = resolveLiveTvPreviewNotification(false);
  assert.equal(preview.title, 'Preview unavailable');
  assert.match(preview.message, /could not be loaded/i);
  assert.equal(preview.persistent, false);

  const custom = resolveLiveTvPreviewNotification(true, 'Stream URL missing.');
  assert.equal(custom.message, 'Stream URL missing.');
  assert.equal(custom.persistent, true);
});

test('Live TV shell state keeps category rail usable without channels', () => {
  const shell = createLiveTvShellState('sports');
  assert.equal(shell.selectedCategoryId, 'sports');
  assert.equal(shell.selectedChannelId, '');
  assert.equal(shell.previewStatus, 'idle');
  assert.equal(shell.fullscreenChannelId, null);
});
