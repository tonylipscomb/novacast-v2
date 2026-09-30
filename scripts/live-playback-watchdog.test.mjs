import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const watchdog = readFileSync(new URL('../src/features/live/livePlaybackWatchdog.ts', import.meta.url), 'utf8');
const screen = readFileSync(new URL('../src/features/live/LiveTvScreen.tsx', import.meta.url), 'utf8');

test('watchdog uses an event-driven ten-second stall observation and bounded cooldown', () => {
  assert.match(watchdog, /LIVE_PLAYBACK_WATCHDOG_STALL_MS = 10_000/);
  assert.match(watchdog, /LIVE_PLAYBACK_WATCHDOG_COOLDOWN_MS = 25_000/);
  assert.match(watchdog, /LIVE_PLAYBACK_WATCHDOG_MAX_ATTEMPTS = 2/);
  assert.doesNotMatch(watchdog, /setInterval/);
});

test('watchdog requires active fullscreen context, prior playability, and progress history', () => {
  assert.match(watchdog, /context\.expectedActive/);
  assert.match(watchdog, /!context\.channelChanging/);
  assert.match(watchdog, /!context\.userPaused/);
  assert.match(watchdog, /playable/);
  assert.match(watchdog, /playbackStarted/);
  assert.match(watchdog, /lastProgressAt !== null/);
});

test('progress recovery resets the episode and emits a bounded success event', () => {
  assert.match(watchdog, /live_watchdog_recovered/);
  assert.match(watchdog, /if \(attempts > 0\) markRecovered\(\)/);
  assert.match(watchdog, /cooldownUntil = now\(\) \+ LIVE_PLAYBACK_WATCHDOG_COOLDOWN_MS/);
});

test('recovery is limited to same-channel retry then same-channel rebind', () => {
  assert.match(screen, /attempt === 1\) retryLiveStream\(\)/);
  assert.match(screen, /else rebindLiveStream\(\)/);
  assert.match(watchdog, /attempt === 1 \? 'same-channel-retry' : 'same-channel-rebind'/);
  assert.match(screen, /setPreviewStreamSource\(null\)/);
  assert.match(screen, /setPreviewStreamSource\(source\)/);
});

test('channel, source, player, pause, and teardown changes clear watchdog timers/state', () => {
  assert.match(watchdog, /reset\('source-change'\)/);
  assert.match(watchdog, /a\.streamKey === b\.streamKey/);
  assert.match(screen, /streamKey: playerStreamUrl/);
  assert.match(watchdog, /setUserPaused\(paused\)/);
  assert.match(watchdog, /reset\('player-teardown'\)/);
  assert.match(screen, /livePlaybackWatchdog\.dispose\(\)/);
  assert.match(screen, /playerGeneration: playerGenerationId/);
});

test('diagnostics use bounded safe metadata only', () => {
  assert.match(screen, /recordLivePerformanceEvent\(event, fields\)/);
  assert.match(watchdog, /attempt/);
  assert.match(watchdog, /stallDurationMs/);
  assert.match(watchdog, /recoveryMethod/);
  for (const forbidden of ['streamUrl', 'username', 'password', 'authorization', 'rawResponse']) {
    assert.doesNotMatch(watchdog, new RegExp(`\\b${forbidden}\\b`));
  }
});

test('Live fullscreen surface feeds status, playing, first-frame, and time observations', () => {
  assert.match(screen, /onStatusChange=\{handleLivePlayerStatusChange\}/);
  assert.match(screen, /onPlayingChange=\{handleLivePlayerPlayingChange\}/);
  assert.match(screen, /onTimeUpdate=\{handleLivePlayerTimeUpdate\}/);
  assert.match(screen, /livePlaybackWatchdog\.markPlayable\(\)/);
  assert.match(screen, /livePlaybackWatchdog\.onTimeUpdate\(currentTime\)/);
});

console.log('live-playback-watchdog: 7 passed');
