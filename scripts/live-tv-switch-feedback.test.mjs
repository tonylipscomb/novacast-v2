// Stage 4.2S.1 — Live TV switch feedback + focus-boundary + latency instrumentation.
//
// Run: node --experimental-strip-types --test scripts/live-tv-switch-feedback.test.mjs
//
// These tests exercise the pure decision helpers (loader visibility, focus restoration,
// left-boundary fallback) and the switch-latency instrumentation without React or native
// dependencies. Two source-inspection tests assert the non-blocking loader contract in
// LiveTvScreen.tsx (focus is never stolen, existing rows stay mounted).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  LIVE_TV_SWITCH_LOADER_THRESHOLD_MS,
  resolveLeftBoundaryTarget,
  resolveSwitchFocusTarget,
  shouldShowSwitchLoader,
} from '../src/features/live/liveTvSwitchFeedback.ts';

import {
  beginSwitchTrace,
  endSwitchTrace,
  enableLiveTvSwitchDiagnosticsForTests,
  getSwitchDiagnosticsSnapshot,
  markSwitchEvent,
  recordLeftBoundaryResolution,
  resetLiveTvSwitchDiagnostics,
  setLiveTvSwitchClockForTests,
  summarizeSwitchTrace,
} from '../src/features/live/liveTvSwitchDiagnostics.ts';

// ---------------------------------------------------------------------------
// 1. Left-boundary focus resolution (the LEFT-skip fix)
// ---------------------------------------------------------------------------

test('1. LEFT resolves to the selected category when its row is mounted', () => {
  const result = resolveLeftBoundaryTarget({
    selectedCategoryId: 'sports',
    selectedCategoryHandle: 42,
    favoritesId: 'favorites',
    favoritesHandle: 7,
    firstCategoryId: 'all',
    firstCategoryHandle: 3,
  });
  assert.deepEqual(result, { handle: 42, targetId: 'sports', fallbackUsed: false });
});

test('2. LEFT falls back to Favorites when the selected row is transiently unmounted', () => {
  const result = resolveLeftBoundaryTarget({
    selectedCategoryId: 'sports',
    selectedCategoryHandle: null,
    favoritesId: 'favorites',
    favoritesHandle: 7,
    firstCategoryId: 'all',
    firstCategoryHandle: 3,
  });
  assert.deepEqual(result, { handle: 7, targetId: 'favorites', fallbackUsed: true });
});

test('3. LEFT falls back to the first category when selected + favorites are unmounted', () => {
  const result = resolveLeftBoundaryTarget({
    selectedCategoryId: 'sports',
    selectedCategoryHandle: null,
    favoritesId: 'favorites',
    favoritesHandle: undefined,
    firstCategoryId: 'all',
    firstCategoryHandle: 3,
  });
  assert.deepEqual(result, { handle: 3, targetId: 'all', fallbackUsed: true });
});

test('4. LEFT returns an undefined handle (no crash) when nothing is mounted', () => {
  const result = resolveLeftBoundaryTarget({
    selectedCategoryId: 'sports',
    selectedCategoryHandle: null,
    favoritesId: 'favorites',
    favoritesHandle: null,
    firstCategoryId: 'all',
    firstCategoryHandle: null,
  });
  assert.deepEqual(result, { handle: undefined, targetId: null, fallbackUsed: false });
});

// ---------------------------------------------------------------------------
// 5-7. Deterministic focus restoration after a switch commits new channels
// ---------------------------------------------------------------------------

test('5. Focus restores the previous channel when it survives the switch', () => {
  const target = resolveSwitchFocusTarget('ch-2', [{ id: 'ch-1' }, { id: 'ch-2' }, { id: 'ch-3' }]);
  assert.deepEqual(target, { kind: 'channel', channelId: 'ch-2' });
});

test('6. Provider switch: a stale previous id cannot survive, so focus lands on the first channel', () => {
  // A provider switch produces an entirely new id space; the old id is simply absent.
  const target = resolveSwitchFocusTarget('old-provider-ch-9', [{ id: 'new-1' }, { id: 'new-2' }]);
  assert.deepEqual(target, { kind: 'channel', channelId: 'new-1' });
});

test('7. Empty category/provider keeps focus on the category rail (never a stale handle)', () => {
  const target = resolveSwitchFocusTarget('ch-2', []);
  assert.deepEqual(target, { kind: 'category-rail' });
});

// ---------------------------------------------------------------------------
// 8-11. Non-blocking loader visibility (no flash for fast switches)
// ---------------------------------------------------------------------------

test('8. Loader hidden once loading ends (fast switch that already resolved)', () => {
  assert.equal(shouldShowSwitchLoader({ isLoadingChannels: false, elapsedMs: 5000 }), false);
});

test('9. Loader hidden while loading but still under the threshold (no flash)', () => {
  assert.equal(
    shouldShowSwitchLoader({ isLoadingChannels: true, elapsedMs: LIVE_TV_SWITCH_LOADER_THRESHOLD_MS - 1 }),
    false,
  );
});

test('10. Loader shown only after a genuinely slow switch crosses the threshold', () => {
  assert.equal(
    shouldShowSwitchLoader({ isLoadingChannels: true, elapsedMs: LIVE_TV_SWITCH_LOADER_THRESHOLD_MS }),
    true,
  );
});

test('11. Loader honours a caller-provided threshold override', () => {
  assert.equal(shouldShowSwitchLoader({ isLoadingChannels: true, elapsedMs: 120, thresholdMs: 100 }), true);
  assert.equal(shouldShowSwitchLoader({ isLoadingChannels: true, elapsedMs: 80, thresholdMs: 100 }), false);
});

// ---------------------------------------------------------------------------
// 12. Diagnostics disabled by default — must be a total no-op (runs BEFORE enabling)
// ---------------------------------------------------------------------------

test('12. Switch diagnostics are a no-op until explicitly enabled', () => {
  const traceId = beginSwitchTrace('category', { categoryId: 'sports' });
  assert.equal(traceId, -1);
  markSwitchEvent(traceId, 'content_ready');
  assert.equal(endSwitchTrace(traceId), null);
  const snapshot = getSwitchDiagnosticsSnapshot();
  assert.equal(snapshot.summaries.length, 0);
  assert.equal(snapshot.boundaryResolutions.length, 0);
  assert.equal(snapshot.activeTraceCount, 0);
});

// ---------------------------------------------------------------------------
// 13-15. Enabled instrumentation with a deterministic injected clock
// ---------------------------------------------------------------------------

test('13. A category switch trace records ordered phase marks with category_switch_started first', () => {
  enableLiveTvSwitchDiagnosticsForTests();
  resetLiveTvSwitchDiagnostics();
  let now = 1000;
  setLiveTvSwitchClockForTests(() => now);

  const traceId = beginSwitchTrace('category', { categoryId: 'sports' });
  assert.ok(traceId > 0);
  now = 1010;
  markSwitchEvent(traceId, 'current_rows_retained', { retainedRows: 30 });
  now = 1020;
  markSwitchEvent(traceId, 'channel_query_started');
  now = 1180;
  markSwitchEvent(traceId, 'channel_query_finished', { rowCount: 42 });
  now = 1190;
  markSwitchEvent(traceId, 'row_pool_rebuilt', { rowCount: 42 });
  now = 1200;
  markSwitchEvent(traceId, 'content_ready', { rowCount: 42 });
  now = 1205;
  const summary = endSwitchTrace(traceId);

  assert.ok(summary);
  assert.equal(summary.kind, 'category');
  assert.equal(summary.marks[0].event, 'category_switch_started');
  assert.equal(summary.channelQueryMs, 160); // 1180 - 1020
  assert.equal(summary.rowRebuildMs, 10); // 1190 - 1180
  assert.equal(summary.contentReadyMs, 200); // 1200 - 1000
  assert.equal(summary.totalMs, 205); // 1205 - 1000

  setLiveTvSwitchClockForTests();
});

test('14. summarizeSwitchTrace is pure and measures the focus-restore window', () => {
  const summary = summarizeSwitchTrace({
    id: 99,
    kind: 'provider',
    categoryId: null,
    providerId: 'prov-1',
    startedAtMs: 0,
    endedAtMs: 300,
    marks: [
      { event: 'provider_switch_started', atMs: 0 },
      { event: 'channel_query_started', atMs: 20 },
      { event: 'channel_query_finished', atMs: 220 },
      { event: 'row_pool_rebuilt', atMs: 240 },
      { event: 'content_ready', atMs: 250 },
      { event: 'focus_restore_started', atMs: 255 },
      { event: 'focus_restore_finished', atMs: 275 },
    ],
  });
  assert.equal(summary.channelQueryMs, 200);
  assert.equal(summary.rowRebuildMs, 20);
  assert.equal(summary.contentReadyMs, 250);
  assert.equal(summary.focusRestoreMs, 20);
  assert.equal(summary.totalMs, 300);
});

test('15. Left-boundary resolutions are captured with fallback details when enabled', () => {
  enableLiveTvSwitchDiagnosticsForTests();
  resetLiveTvSwitchDiagnostics();
  recordLeftBoundaryResolution({
    currentFocusId: 'ch-2',
    intendedTargetId: 'sports',
    resolvedHandle: true,
    targetMounted: false,
    fallbackUsed: true,
    fallbackTargetId: 'favorites',
    providerId: 'prov-1',
    selectedCategoryId: 'sports',
  });
  const snapshot = getSwitchDiagnosticsSnapshot();
  assert.equal(snapshot.boundaryResolutions.length, 1);
  assert.equal(snapshot.boundaryResolutions[0].fallbackUsed, true);
  assert.equal(snapshot.boundaryResolutions[0].fallbackTargetId, 'favorites');
});

// ---------------------------------------------------------------------------
// 16-17. Source-inspection: the content-pane loader must never steal focus and must
// leave existing channel rows mounted (non-blocking overlay, not a replacement).
// ---------------------------------------------------------------------------

const liveTvScreenSource = readFileSync(
  fileURLToPath(new URL('../src/features/live/LiveTvScreen.tsx', import.meta.url)),
  'utf8',
);

test('16. Switch loader overlay is non-focusable and pointer-transparent', () => {
  const overlayMatch = liveTvScreenSource.match(
    /showSwitchLoader \? \(([\s\S]*?)\) : null}/,
  );
  assert.ok(overlayMatch, 'expected a showSwitchLoader overlay block');
  const overlay = overlayMatch[1];
  assert.match(overlay, /pointerEvents="none"/);
  assert.match(overlay, /focusable=\{false\}/);
});

test('17. The channel list stays rendered while the loader overlay is shown', () => {
  // The loader is additive (sibling overlay) — the existing <LiveTvChannelList> is not
  // replaced by the loader, so rows remain visible during a slow switch.
  assert.match(liveTvScreenSource, /<LiveTvChannelList[\s\S]*?showSwitchLoader \? \(/);
});

test('18. Fullscreen close restores the category scroll + boundary handles', () => {
  // The browse subtree (category FlatList) unmounts during fullscreen and remounts
  // fresh on close, snapping the rail to offset 0 and detaching the selected category
  // row the LEFT handle points at. The close transition must scroll the selected
  // category back into view and re-resolve the boundary handles.
  const effectMatch = liveTvScreenSource.match(
    /didFullscreenJustClose\(previousFullscreenChannelId, currentFullscreenChannelId\)[\s\S]*?scrollCategoryIntoView\(categoryId\)[\s\S]*?refreshBoundaryFocusHandles\(\)/,
  );
  assert.ok(effectMatch, 'expected a fullscreen-close scroll-restore effect');
  // It reads the still-selected category from the live-state ref (not categories[0]).
  assert.match(effectMatch[0], /liveStateRef\.current\?\.selectedCategoryId/);
});

test('19. Category list mounts scrolled to the selected category (keeps its row mounted)', () => {
  // getItemLayout + initialScrollIndex make the remounted category FlatList render the
  // window around the selected category, so its row (and node handle) survives the
  // browse remount that fullscreen playback forces — the LEFT boundary target stays live.
  assert.match(liveTvScreenSource, /getItemLayout=\{getCategoryItemLayout\}/);
  assert.match(liveTvScreenSource, /initialScrollIndex=\{selectedCategoryInitialScrollIndex\}/);
  // The index is derived from the currently-selected category, undefined when it's the top.
  assert.match(
    liveTvScreenSource,
    /selectedCategoryScrollIndex = categories\.findIndex\([\s\S]*?category\.id === renderState\.selectedCategoryId/,
  );
  assert.match(
    liveTvScreenSource,
    /selectedCategoryScrollIndex > 0 \? selectedCategoryScrollIndex : undefined/,
  );
});

