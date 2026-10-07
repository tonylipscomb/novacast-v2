import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const watchdog = readFileSync(new URL('../src/features/live/livePlaybackWatchdog.ts', import.meta.url), 'utf8');
const screen = readFileSync(new URL('../src/features/live/LiveTvScreen.tsx', import.meta.url), 'utf8');
const player = readFileSync(new URL('../src/features/playback/NovaStreamPlayer.tsx', import.meta.url), 'utf8');

test('watchdog uses an event-driven ten-second stall observation and bounded cooldown', () => {
  assert.match(watchdog, /LIVE_PLAYBACK_WATCHDOG_STALL_MS = 10_000/);
  assert.match(watchdog, /LIVE_PLAYBACK_WATCHDOG_COOLDOWN_MS = 25_000/);
  assert.match(watchdog, /LIVE_PLAYBACK_WATCHDOG_MAX_ATTEMPTS = 2/);
  assert.match(watchdog, /LIVE_PLAYBACK_WATCHDOG_LOG_INTERVAL_MS = 2_000/);
  assert.doesNotMatch(watchdog, /setInterval/);
});

test('watchdog requires active fullscreen context, prior playability, and progress history', () => {
  assert.match(watchdog, /context\.expectedActive/);
  assert.match(watchdog, /!context\.channelChanging/);
  assert.match(watchdog, /!context\.userPaused/);
  assert.match(watchdog, /playable/);
  assert.match(watchdog, /playbackStarted/);
  assert.match(watchdog, /lastRealProgressAt !== null/);
});

test('progress recovery resets the episode and emits a bounded success event', () => {
  assert.match(watchdog, /live_watchdog_recovered/);
  assert.match(watchdog, /if \(attempts > 0\) markRecovered\(\)/);
  assert.match(watchdog, /cooldownUntil = now\(\) \+ LIVE_PLAYBACK_WATCHDOG_COOLDOWN_MS/);
});

test('recovery uses same-player retry and rebind without a null-source transition', () => {
  assert.match(screen, /attempt === 1\) retryLiveStream\(\)/);
  assert.match(screen, /else rebindLiveStream\(\)/);
  assert.match(watchdog, /attempt === 1 \? 'same-channel-retry' : 'same-channel-rebind'/);
  assert.match(screen, /same-player-rebind/);
  assert.doesNotMatch(screen, /const source = previewStreamSource;[\s\S]*setPreviewStreamSource\(null\);[\s\S]*setPreviewStreamSource\(source\)/);
});

test('source identity stabilization compares URI/content type instead of object identity', () => {
  assert.match(player, /function getSourceIdentity\(source: VideoSource\)/);
  assert.match(player, /contentType:\$\{source\.contentType \?\? ''\}/);
  assert.match(player, /lastSourceIdentityRef\.current === sourceIdentity/);
  assert.doesNotMatch(player, /lastUrlRef/);
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
  assert.match(watchdog, /elapsedSinceProgressMs/);
  assert.match(screen, /NOVACAST_PLAYBACK_RECOVERY/);
  for (const forbidden of ['streamUrl', 'username', 'password', 'authorization', 'rawResponse']) {
    assert.doesNotMatch(watchdog, new RegExp(`\\b${forbidden}\\b`));
  }
});

test('watchdog emits explicit decision diagnostics and uses real progress metadata', () => {
  assert.match(watchdog, /\[NOVACAST_WATCHDOG\]/);
  assert.match(watchdog, /console\.warn\(WATCHDOG_LOG_TAG/);
  assert.doesNotMatch(watchdog, /console\.info\(WATCHDOG_LOG_TAG/);
  assert.match(watchdog, /isHighFrequency = event === 'health-sample' \|\| event === 'watchdog-armed'/);
  for (const event of ['watchdog-armed', 'watchdog-disarmed', 'health-sample', 'stall-suspected', 'stall-confirmed', 'recovery-start', 'recovery-player-reload', 'recovery-success', 'recovery-failed', 'cooldown-start', 'cooldown-complete', 'generation-invalidated']) {
    assert.match(watchdog, new RegExp(event));
  }
  assert.match(watchdog, /progress-not-observed/);
  assert.match(watchdog, /positionAvailable = currentTime >= 0/);
  assert.match(watchdog, /currentLiveTimestamp/);
  assert.match(watchdog, /bufferedPosition/);
  assert.match(watchdog, /lastRealProgressAt/);
  assert.match(watchdog, /elapsedSinceRealProgressMs/);
  assert.match(watchdog, /playerStateHealthy/);
  assert.match(watchdog, /renderProgressHealthy/);
  assert.match(watchdog, /stalledSignal: lastProgressSignalType/);
  assert.doesNotMatch(watchdog, /playbackSpeed/);
  for (const forbidden of ['streamUrl', 'username', 'password', 'authorization', 'rawResponse', 'providerHost']) {
    assert.doesNotMatch(watchdog, new RegExp(`\\b${forbidden}\\b`));
  }
});

test('player state callbacks do not refresh real progress or reset the stall deadline', () => {
  assert.match(watchdog, /triggerReason: 'player-ready'/);
  assert.match(watchdog, /triggerReason: 'playing-state'/);
  assert.doesNotMatch(watchdog, /status === 'readyToPlay'[\s\S]{0,180}lastRealProgressAt\s*=/);
  assert.doesNotMatch(watchdog, /if \(isPlaying\)[\s\S]{0,180}lastRealProgressAt\s*=/);
  assert.match(watchdog, /lastRealProgressAt = now\(\);/);
});

test('Live player enables bounded time samples for alternate progress signals', () => {
  assert.match(player, /timeUpdateEventInterval = bufferPolicy === 'live' \? 1 : 0/);
  assert.match(screen, /currentLiveTimestamp/);
  assert.match(screen, /bufferedPosition/);
  assert.match(screen, /livePlaybackWatchdog\.onTimeUpdate\(currentTime, \{ currentLiveTimestamp, bufferedPosition \}\)/);
});

test('unavailable position requires an alternate advancing signal or eventually stalls', () => {
  assert.match(watchdog, /positionAvailable = currentTime >= 0/);
  assert.match(watchdog, /liveTimestampProgressed/);
  assert.match(watchdog, /bufferedPositionProgressed/);
  assert.match(watchdog, /!positionProgressed && !liveTimestampProgressed && !bufferedPositionProgressed/);
  assert.match(watchdog, /LIVE_PLAYBACK_WATCHDOG_STALL_MS - \(now\(\) - \(lastRealProgressAt \?\? now\(\)\)\)/);
});

test('watchdog recovery is generation-bound and cannot complete on a stale player', () => {
  assert.match(watchdog, /recoveryGeneration = context\.playerGeneration/);
  assert.match(watchdog, /recovery-completed-on-stale-generation/);
});

test('Live fullscreen surface feeds status, playing, first-frame, and time observations', () => {
  assert.match(screen, /onStatusChange=\{handleLivePlayerStatusChange\}/);
  assert.match(screen, /onPlayingChange=\{handleLivePlayerPlayingChange\}/);
  assert.match(screen, /onTimeUpdate=\{handleLivePlayerTimeUpdate\}/);
  assert.match(screen, /livePlaybackWatchdog\.markPlayable\(\)/);
  assert.match(screen, /livePlaybackWatchdog\.onTimeUpdate\(currentTime, \{ currentLiveTimestamp, bufferedPosition \}\)/);
});

console.log('live-playback-watchdog: 10 passed');
