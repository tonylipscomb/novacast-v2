import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

const root = process.cwd();
const analytics = fs.readFileSync(path.join(root, 'src', 'features', 'analytics', 'playbackAnalytics.ts'), 'utf8');
const types = fs.readFileSync(path.join(root, 'src', 'features', 'analytics', 'analyticsTypes.ts'), 'utf8');
const controller = fs.readFileSync(path.join(root, 'src', 'features', 'playback', 'unified', 'UnifiedPlayerController.tsx'), 'utf8');
const surface = fs.readFileSync(path.join(root, 'src', 'features', 'playback', 'NovaStreamPlayer.tsx'), 'utf8');
const overlay = fs.readFileSync(path.join(root, 'src', 'features', 'playback', 'unified', 'UnifiedPlayerOverlay.tsx'), 'utf8');
const live = fs.readFileSync(path.join(root, 'src', 'features', 'live', 'LiveTvScreen.tsx'), 'utf8');
const queue = fs.readFileSync(path.join(root, 'src', 'features', 'analytics', 'analyticsQueue.ts'), 'utf8');
const lifecycle = fs.readFileSync(path.join(root, 'src', 'features', 'analytics', 'analyticsLifecycle.ts'), 'utf8');
const nova = fs.readFileSync(path.join(root, 'src', 'features', 'analytics', 'novaAnalytics.ts'), 'utf8');

function loadTracker() {
  const output = transpileModule(analytics, {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require: (request) => request.endsWith('novaAnalytics')
      ? { enqueueAnalyticsEvent: () => Promise.resolve(true) }
      : {},
    console,
  }, { filename: 'playbackAnalytics.ts' });
  return module.exports.createPlaybackAnalyticsTracker;
}

function item(mediaType) {
  return {
    id: `${mediaType}-1`,
    mediaType,
    title: 'Test',
    streamUrl: 'https://safe.invalid/stream',
    isLive: mediaType === 'live',
  };
}

test('C1 declares only the five playback lifecycle events', () => {
  for (const eventName of ['playback_requested', 'playback_started', 'playback_failed', 'playback_recovered', 'playback_stopped']) {
    assert.match(types, new RegExp(`'${eventName}'`));
    assert.match(analytics, new RegExp(`'${eventName}'`));
  }
  assert.doesNotMatch(types, /playback_completed/);
});

test('playback hooks prefer native first frame and fall back to ready playing transition', () => {
  assert.match(controller, /playbackAnalyticsTracker\.request\(snapshot\.item/);
  assert.match(controller, /playbackAnalyticsTracker\.firstFrame\(\)/);
  assert.match(controller, /playbackAnalyticsTracker\.firstFrame\('playing_transition'\)/);
  assert.match(controller, /isPlaying && player\.status === 'readyToPlay'/);
  assert.match(controller, /SurfaceView never reports a valid layout/);
  assert.match(controller, /playbackAnalyticsTracker\.stop\('user_back'\)/);
  assert.match(analytics, /timestamp - attempt\.requestedAt/);
  assert.match(analytics, /timestamp - attempt\.startedAt/);
});

test('playback analytics records attempt-scoped diagnostics and preserves one start', () => {
  for (const logEvent of [
    'playback request',
    'playback started',
    'playback failed',
    'playback recovered',
    'playback stopped',
  ]) {
    assert.match(analytics, new RegExp(logEvent.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
  }
  assert.match(analytics, /attemptId/);
  assert.match(analytics, /attempt\.startedAt !== null/);
  assert.match(analytics, /attempt\.stopped/);
});

test('playback content type is top-level and limited to live, movie, or series', () => {
  assert.match(analytics, /contentType: attempt\.contentType/);
  assert.match(nova, /contentType\?: string/);
  assert.doesNotMatch(analytics, /content_type:/);
  assert.doesNotMatch(analytics, /metadata: \{ content_type/);
  assert.match(analytics, /if \(item\.mediaType === 'movie'\) return 'movie'/);
  assert.match(analytics, /if \(item\.mediaType === 'episode'\) return 'series'/);
  assert.match(analytics, /return 'live'/);
  assert.match(nova, /contentType: input\.contentType/);
});

test('release verification logs are removed and only development diagnostics remain', () => {
  assert.match(analytics, /typeof __DEV__ !== 'undefined'/);
  for (const noisyLog of [
    'native first-frame callback entered',
    'player ready/playing transition entered',
    'existing progress callback entered',
    'rendered VideoView mounted',
    'listener attached:',
    'controller mounted',
    'native status transition',
    'native isPlaying transition',
  ]) {
    assert.doesNotMatch(analytics + surface + controller, new RegExp(noisyLog.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
  }
});

test('analytics listeners bind to the player rendered by VideoView', () => {
  assert.match(surface, /player\.addListener\('statusChange'/);
  assert.match(surface, /player\.addListener\('playingChange'/);
  assert.match(surface, /player\.addListener\('timeUpdate'/);
  assert.match(surface, /<VideoView[\s\S]*player=\{player\}/);
  assert.match(overlay, /<NovaStreamSurface[\s\S]*player=\{player\}/);
  assert.match(controller, /onStatusChange=\{handleNativeStatusChange\}/);
  assert.match(controller, /onPlayingChange=\{handleNativePlayingChange\}/);
  assert.match(controller, /onTimeUpdate=\{handleNativeTimeUpdate\}/);
  assert.match(surface, /statusSubscription\.remove\(\)/);
  assert.match(surface, /playingSubscription\.remove\(\)/);
  assert.match(surface, /timeSubscription\.remove\(\)/);
});

test('movie, episode, and live production paths create tracked attempts', () => {
  assert.match(analytics, /if \(item\.mediaType === 'movie'\)/);
  assert.match(analytics, /if \(item\.mediaType === 'episode'\)/);
  assert.match(controller, /playbackAnalyticsTracker\.request\(snapshot\.item/);
  assert.match(live, /playbackAnalyticsTracker\.request\(livePlaybackItem, 'channel'/);
  assert.match(live, /playbackAnalyticsTracker\.stop\('user_back'\)/);
});

test('existing progress fallback starts once only after advancing playback', () => {
  assert.match(controller, /currentTime > 0 && player\.status === 'readyToPlay' && player\.playing/);
  assert.match(controller, /playbackAnalyticsTracker\.firstFrame\('current_time_progress'\)/);
  assert.match(analytics, /attempt\.startedAt !== null/);
  assert.match(analytics, /'playing_transition'/);
});

test('movie, episode, and live trackers emit requested, started, stopped with watch duration', () => {
  const createTracker = loadTracker();
  for (const mediaType of ['movie', 'episode', 'live']) {
    let now = 100;
    const events = [];
    const tracker = createTracker((name, input) => events.push({ name, input }), () => now);
    tracker.request(item(mediaType), 'play');
    now = 250;
    tracker.firstFrame('current_time_progress');
    now = 1_250;
    tracker.stop('user_back');
    assert.deepEqual(events.map(({ name }) => name), [
      'playback_requested',
      'playback_started',
      'playback_stopped',
    ]);
    assert.equal(events[0].input.contentType, mediaType === 'episode' ? 'series' : mediaType);
    for (const event of events) {
      assert.notEqual(event.input.metadata?.content_type, 'live');
      assert.equal('content_type' in (event.input.metadata ?? {}), false);
    }
    assert.equal(events[2].input.durationMs, 1_000);
  }
});

test('duplicate native signals emit one started event and pre-start cancellation emits none', () => {
  const createTracker = loadTracker();
  const events = [];
  let now = 0;
  const tracker = createTracker((name, input) => events.push({ name, input }), () => now);
  tracker.request(item('movie'), 'play');
  now = 100;
  tracker.firstFrame('playing_transition');
  tracker.firstFrame('native_first_frame');
  assert.equal(events.filter(({ name }) => name === 'playback_started').length, 1);

  const cancelled = [];
  const cancelledTracker = createTracker((name, input) => cancelled.push({ name, input }), () => now);
  cancelledTracker.request(item('episode'), 'episode');
  cancelledTracker.failure('cancelled');
  cancelledTracker.stop('user_back');
  assert.equal(cancelled.some(({ name }) => name === 'playback_started'), false);
  assert.equal(cancelled.at(-1).name, 'playback_stopped');
  assert.equal(cancelled.at(-1).input.durationMs, undefined);
});

test('retry creates a fresh attempt timestamp and start timing', () => {
  const createTracker = loadTracker();
  const events = [];
  let now = 10;
  const tracker = createTracker((name, input) => events.push({ name, input }), () => now);
  tracker.request(item('movie'), 'play');
  tracker.failure('timeout');
  now = 1_000;
  tracker.request(item('movie'), 'play', true);
  now = 1_200;
  tracker.firstFrame('current_time_progress');
  assert.deepEqual(events.map(({ name }) => name), [
    'playback_requested',
    'playback_failed',
    'playback_requested',
    'playback_started',
    'playback_recovered',
  ]);
  assert.equal(events[2].input.metadata.retry_count, 1);
  assert.equal(events[3].input.durationMs, 200);
});

test('failed or cancelled attempts cannot start, and retries get fresh request timing', () => {
  assert.match(analytics, /if \(!attempt \|\| attempt\.stopped \|\| attempt\.startedAt !== null\) return false/);
  assert.match(analytics, /requestedAt: now\(\)/);
  assert.match(analytics, /attemptId: nextAttemptId\+\+/);
  assert.match(controller, /playbackAnalyticsTracker\.request\(current\.item, current\.launchSource, true\)/);
});

test('duplicate suppression and failure categorization are centralized', () => {
  assert.match(analytics, /if \(!force && attempt/);
  for (const category of ['network', 'provider', 'timeout', 'decoder', 'unsupported', 'user_cancelled', 'unknown']) {
    assert.match(analytics, new RegExp(`return '${category}'`));
  }
  assert.match(controller, /playbackAnalyticsTracker\.failure\(message\)/);
});

test('buffering metrics and recovery are emitted without polling', () => {
  assert.match(analytics, /bufferingCount/);
  assert.match(analytics, /bufferingDurationMs/);
  assert.match(analytics, /playback_recovered/);
  assert.doesNotMatch(analytics, /setInterval|requestAnimationFrame/);
});

test('playback events use existing queue, offline retention, and retry transport', () => {
  assert.match(analytics, /enqueueAnalyticsEvent/);
  assert.match(queue, /maxAttempts/);
  assert.match(queue, /retryable/);
  assert.match(lifecycle, /status === 'online'.*flushNovaAnalytics/s);
  assert.match(analytics, /providerId/);
  assert.match(analytics, /contentId/);
});
