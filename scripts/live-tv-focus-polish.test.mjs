import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { resolveChannelFocusRetentionTarget, shouldRetainChannelFocus } from '../src/features/live/liveTvFocusRetention.ts';

const root = join(process.cwd(), 'src', 'features', 'live');
const screen = readFileSync(join(root, 'LiveTvScreen.tsx'), 'utf8');
const channelList = readFileSync(join(root, 'LiveTvChannelList.tsx'), 'utf8');
const channelRow = readFileSync(join(root, 'LiveTvChannelRow.tsx'), 'utf8');
const tvPlugin = readFileSync(join(process.cwd(), 'plugins', 'withNovacastTvManifest.js'), 'utf8');

test('fresh Live entry does not mount with preferred category or channel focus', () => {
  assert.match(screen, /const preferCategoryFocusRef = useRef\(false\)/);
  assert.match(screen, /const preferChannelFocusRef = useRef\(false\)/);
});

test('same category focus does not repeat focus state work', () => {
  assert.match(screen, /previousOwner === 'categories' && preferredCategoryFocusId\.current === categoryId/);
  assert.match(screen, /region: 'category'/);
  assert.match(screen, /redundant-focus-state-skipped/);
});

test('same channel focus does not repeat preferred-channel or state work', () => {
  assert.match(screen, /previousOwner === 'channels' && previousFocusedId === channelId/);
  assert.match(screen, /region: 'channel'/);
  assert.doesNotMatch(screen, /setFocusedChannelId/);
});

test('explicit category-to-channel navigation still requests one channel target', () => {
  assert.match(screen, /reason: 'category-ok-to-channels'/);
  assert.match(screen, /region: 'channel-list'/);
});

test('fullscreen close restoration remains imperative and bounded', () => {
  assert.match(screen, /reason: 'fullscreen-close-restore'/);
  assert.match(screen, /maxFrames: 3/);
  assert.match(screen, /lastReadyFullscreenChannelIdRef/);
});

test('passive channel-to-category fallback retains the focused channel', () => {
  assert.equal(shouldRetainChannelFocus({
    previousOwner: 'channels',
    navigationIntent: 'none',
    intentAgeMs: 900,
    focusedChannelId: 'channel-7',
    preferredChannelId: 'channel-6',
    selectedChannelId: 'channel-5',
  }), true);
  assert.equal(resolveChannelFocusRetentionTarget({
    focusedChannelId: 'channel-7',
    preferredChannelId: 'channel-6',
    selectedChannelId: 'channel-5',
  }), 'channel-7');
});

test('legitimate LEFT navigation still permits category focus', () => {
  assert.equal(shouldRetainChannelFocus({
    previousOwner: 'channels',
    navigationIntent: 'left',
    intentAgeMs: 40,
    focusedChannelId: 'channel-7',
    preferredChannelId: 'channel-6',
    selectedChannelId: 'channel-5',
  }), false);
});

test('unexpected category fallback emits bounded retention diagnostics', () => {
  assert.match(screen, /unexpected-region-transition/);
  assert.match(screen, /unexpected-category-focus-retain-channel/);
  assert.match(screen, /restore-in-flight-category-fallback/);
  assert.match(screen, /retryCount/);
  assert.match(screen, /millisecondsSinceLastEpgStateCommit/);
  assert.match(screen, /millisecondsSinceLastMarqueeUpdate/);
});

test('browse LEFT intent is synchronously marked, consumed, and never restores the channel', () => {
  assert.match(screen, /eventType === 'left' \|\| eventType === 'arrowleft'/);
  assert.match(screen, /source: 'native-dpad'/);
  assert.match(screen, /reason: 'native-dpad-left'/);
  assert.match(screen, /lastNavigationIntentRef\.current = \{ intent: 'none', at: 0 \}/);
  assert.match(tvPlugin, /LEFT_INTENT_MARKER/);
  assert.match(tvPlugin, /KEYCODE_DPAD_LEFT && event\.action == KeyEvent\.ACTION_DOWN/);
  assert.match(tvPlugin, /putString\("eventType", "left"\)/);
});

test('channel restore is single-flight and allows only one bounded retry', () => {
  assert.match(screen, /focusRestoreInFlightRef = useRef/);
  assert.match(screen, /requestFocusRestore\(targetChannelId, 0\)/);
  assert.match(screen, /requestFocusRestore\(targetChannelId, 1\)/);
  assert.match(screen, /timeoutMs: 350/);
  assert.match(screen, /clearFocusRestoreInFlight\('bounded-timeout'\)/);
});

test('restore-in-flight category callbacks are quarantined until the channel returns', () => {
  assert.match(screen, /restore-in-flight-category-fallback/);
  assert.match(screen, /if \(restoreInFlight && !isRecentLeftIntent\)/);
  assert.match(screen, /targetChannelId === channelId/);
  assert.match(screen, /clearFocusRestoreInFlight\('target-channel-focused'\)/);
  assert.match(screen, /requestNativeRestoreFocus\(channelId\)/);
  assert.match(screen, /channelsRef\.current\?\.scrollToIndex/);
});

test('a real LEFT aborts restore quarantine and remains allowed', () => {
  assert.match(screen, /clearFocusRestoreInFlight\('legitimate-left'\)/);
  assert.match(screen, /const isRecentLeftIntent = previousOwner === 'channels'/);
  assert.match(screen, /reason: 'native-dpad-left'/);
});

test('mounted channel refs build an imperative vertical neighbor graph', () => {
  assert.match(channelList, /mountedRowRefsRef = useRef/);
  assert.match(channelList, /nextFocusUp:[\s\S]*previous\?\.handle \?\? entry\.handle/);
  assert.match(channelList, /nextFocusDown: next\?\.handle \?\? entry\.handle/);
  assert.match(channelList, /setNativeProps/);
  assert.match(channelList, /channel-native-ref/);
  assert.match(channelRow, /trapFocusRight && focusTrapHandle/);
});

test('raw vertical native telemetry preserves repeat and timing fields without consuming keys', () => {
  assert.match(tvPlugin, /VERTICAL_INTENT_MARKER/);
  assert.match(tvPlugin, /KEYCODE_DPAD_UP \|\| event\.keyCode == KeyEvent\.KEYCODE_DPAD_DOWN/);
  assert.match(tvPlugin, /putInt\("repeatCount", event\.repeatCount\)/);
  assert.match(tvPlugin, /putLong\("eventTime", event\.eventTime\)/);
  assert.match(tvPlugin, /putLong\("downTime", event\.downTime\)/);
  assert.match(screen, /vertical-navigation-intent/);
  assert.match(screen, /nativeDeltaMs/);
  assert.match(screen, /event\.action === 'down'/);
  assert.match(screen, /if \(isDown\)/);
});

test('native ref misses carry the focused neighborhood and identity context', () => {
  assert.match(channelList, /channel-native-ref/);
  assert.match(channelList, /selectedChannelId/);
  assert.match(channelList, /nativeRefPresent/);
  assert.match(channelList, /listKey/);
  assert.match(channelList, /lastNavigationIntent/);
  assert.match(channelList, /timestamp/);
});
