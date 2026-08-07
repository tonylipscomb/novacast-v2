import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chooseLiveChannel,
  closeLiveFullscreen,
  createInitialLiveTvState,
  focusLiveChannel,
  resolveLivePreview,
  selectLiveCategory,
} from '../src/features/live/liveTvLogic.ts';
import {
  decideLiveTvBackAction,
  didFullscreenJustClose,
  didFullscreenJustOpen,
  isChannelPressEnteringFullscreen,
  shouldFocusPreviewActionAfterChannelOk,
} from '../src/features/live/liveTvFocusRestoration.ts';
import { dedupeCountryCategoryLabel } from '../src/features/live/liveTvCategoryLabel.ts';

// Stage 4.2S — Live TV is now selection-driven. Focus browses freely; OK selects a
// channel and starts its preview; the Play action opens fullscreen. These tests lock
// the guarantees that the LiveTvScreen component relies on after focus-driven preview
// scheduling was removed from focusChannelRow.

function readyState(channelId) {
  // Land on `channelId`, then let its preview resolve to ready so it becomes the
  // confirmed, watchable selection.
  const base = createInitialLiveTvState('entertainment', channelId);
  return resolveLivePreview(base, base.previewRequestId, channelId, 'ready');
}

test('1. focusing a channel never starts or restarts a preview', () => {
  const state = readyState('cnn');
  const next = focusLiveChannel(state, 'espn');

  assert.equal(next.previewChannelId, 'cnn');
  assert.equal(next.previewStatus, 'ready');
  assert.equal(next.previewRequestId, state.previewRequestId, 'no new stream request on focus');
});

test('2. rapid scrolling across many channels resolves zero new streams', () => {
  const start = readyState('cnn');
  const scrolled = ['espn', 'fox', 'nbc', 'abc', 'cbs', 'tnt'].reduce(
    (state, channelId) => focusLiveChannel(state, channelId),
    start,
  );

  assert.equal(scrolled.previewChannelId, 'cnn', 'preview stays on the selected channel');
  assert.equal(scrolled.previewRequestId, start.previewRequestId, 'no preview requests fired while scrolling');
});

test('3. focusing a different channel clears the confirmation but keeps the preview', () => {
  const state = readyState('cnn');
  assert.equal(state.previewConfirmedChannelId, 'cnn');

  const next = focusLiveChannel(state, 'espn');
  assert.equal(next.previewConfirmedChannelId, null, 'focus no longer treats the old channel as confirmed');
  assert.equal(next.previewChannelId, 'cnn', 'but the live preview does not move');
});

test('4. OK commits the selected channel and starts its preview loading', () => {
  const state = readyState('cnn');
  const afterFocus = focusLiveChannel(state, 'espn');
  const next = chooseLiveChannel(afterFocus, 'espn');

  assert.equal(next.selectedChannelId, 'espn');
  assert.equal(next.previewChannelId, 'espn');
  assert.equal(next.previewStatus, 'loading');
  assert.equal(next.previewConfirmedChannelId, 'espn');
  assert.equal(next.previewRequestId, afterFocus.previewRequestId + 1, 'exactly one new stream request');
});

test('5. an OK selection moves focus to the Play action (not fullscreen)', () => {
  const state = readyState('cnn');
  const afterFocus = focusLiveChannel(state, 'espn');
  const next = chooseLiveChannel(afterFocus, 'espn');

  assert.equal(isChannelPressEnteringFullscreen(afterFocus, 'espn'), false);
  assert.equal(shouldFocusPreviewActionAfterChannelOk(afterFocus, next, 'espn'), true);
});

test('6. focusing another channel after a selection does not replace the preview', () => {
  const state = readyState('cnn');
  const afterSelect = resolveLivePreview(
    chooseLiveChannel(focusLiveChannel(state, 'espn'), 'espn'),
    state.previewRequestId + 1,
    'espn',
    'ready',
  );

  const browsed = focusLiveChannel(afterSelect, 'fox');
  assert.equal(browsed.previewChannelId, 'espn', 'preview stays on the deliberately selected channel');
  assert.equal(browsed.previewStatus, 'ready');
});

test('7. selecting a second channel replaces the preview', () => {
  const state = readyState('cnn');
  const browsed = focusLiveChannel(state, 'fox');
  const next = chooseLiveChannel(browsed, 'fox');

  assert.equal(next.previewChannelId, 'fox');
  assert.equal(next.previewStatus, 'loading');
  assert.equal(next.previewRequestId, browsed.previewRequestId + 1);
});

test('8. pressing Play (OK on the confirmed ready channel) opens fullscreen', () => {
  const state = readyState('cnn');
  assert.equal(isChannelPressEnteringFullscreen(state, 'cnn'), true);

  const next = chooseLiveChannel(state, 'cnn');
  assert.equal(next.fullscreenChannelId, 'cnn');
  assert.equal(didFullscreenJustOpen(state.fullscreenChannelId, next.fullscreenChannelId), true);
});

test('9. Back closes fullscreen and the restoration window swallows a stray Back', () => {
  const opened = chooseLiveChannel(readyState('cnn'), 'cnn');
  assert.equal(decideLiveTvBackAction(opened.fullscreenChannelId, false), 'close-fullscreen');

  const closed = closeLiveFullscreen(opened);
  assert.equal(closed.fullscreenChannelId, null);
  assert.equal(didFullscreenJustClose(opened.fullscreenChannelId, closed.fullscreenChannelId), true);
  assert.equal(decideLiveTvBackAction(closed.fullscreenChannelId, true), 'swallow', 'stray Back during focus restore is swallowed');
  assert.equal(decideLiveTvBackAction(closed.fullscreenChannelId, false), 'leave-screen');
});

test('10. switching category selects its first channel and previews it once', () => {
  const state = readyState('cnn');
  const next = selectLiveCategory(state, 'sports', 'espn-hd');

  assert.equal(next.selectedCategoryId, 'sports');
  assert.equal(next.selectedChannelId, 'espn-hd');
  assert.equal(next.previewChannelId, 'espn-hd');
  assert.equal(next.previewStatus, 'loading');
  assert.equal(next.previewRequestId, state.previewRequestId + 1);
});

// --- Change A: country label dedup (display-only) ---

test('15. an exact country label collapses to the badge only', () => {
  assert.equal(dedupeCountryCategoryLabel('US', 'US'), '');
  assert.equal(dedupeCountryCategoryLabel('UK', 'GB'), '');
});

test('16. a country-prefixed label drops just the redundant country token', () => {
  assert.equal(dedupeCountryCategoryLabel('US News', 'US'), 'News');
  assert.equal(dedupeCountryCategoryLabel('US | Sports', 'US'), 'Sports');
  assert.equal(dedupeCountryCategoryLabel('UK Movies', 'GB'), 'Movies');
  assert.equal(dedupeCountryCategoryLabel('UK Movies', 'UK'), 'Movies');
  assert.equal(dedupeCountryCategoryLabel('GB Movies', 'GB'), 'Movies');
});

test('17. unrelated labels are preserved verbatim (no partial-word stripping)', () => {
  assert.equal(dedupeCountryCategoryLabel('USA Network', 'US'), 'USA Network', 'must not become "A Network"');
  assert.equal(dedupeCountryCategoryLabel('Sports', 'US'), 'Sports');
  assert.equal(dedupeCountryCategoryLabel('Ukraine News', 'UK'), 'Ukraine News');
});

test('18. dedup is display-only and never touches provider data', () => {
  const category = { name: 'US News', countryCode: 'US' };
  const result = dedupeCountryCategoryLabel(category.name, category.countryCode);

  assert.equal(result, 'News');
  assert.equal(category.name, 'US News', 'source label is untouched');
  assert.equal(category.countryCode, 'US', 'country code is untouched');
  // Missing / multi-region markers fall through unchanged.
  assert.equal(dedupeCountryCategoryLabel('US News', undefined), 'US News');
  assert.equal(dedupeCountryCategoryLabel('MULTI Sports', 'MULTI'), 'MULTI Sports');
});
