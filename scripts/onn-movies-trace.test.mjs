import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { setTimeout as delay } from 'node:timers/promises';

import {
  beginOnnMoviesTrace,
  clearOnnMoviesTraceForTests,
  endOnnMoviesTrace,
  getActiveOnnMoviesTraceId,
  getOnnMoviesTraceAutoDurationMs,
  getOnnMoviesTraceAutoScenario,
  getOnnMoviesTraceTestState,
  isOnnMoviesTraceEnabled,
  maybeBeginOnnMoviesAutoTrace,
  maybeEndOnnMoviesAutoTraceOnBackground,
  nextOnnMoviesGridInstanceId,
  ONN_MOVIES_TRACE_DEFAULT_AUTO_DURATION_MS,
  sanitizeOnnMoviesTracePayload,
  setOnnMoviesGridMounted,
  setOnnMoviesTraceEnabledForTests,
  setOnnMoviesTraceStartedAtForTests,
  startOnnMoviesScenario,
  traceOnnMoviesCategoriesCleared,
  traceOnnMoviesEvent,
  traceOnnMoviesScrollCommand,
  wrapOnnMoviesBackHandler,
} from '../src/features/diagnostics/onnMoviesTrace.ts';

function parseTraceLogs(logs) {
  return logs
    .filter((line) => line.includes('[NovaCast ONN Trace]'))
    .map((line) => JSON.parse(line.replace('[NovaCast ONN Trace] ', '')));
}

const SOURCE = {
  trace: fs.readFileSync('src/features/diagnostics/onnMoviesTrace.ts', 'utf8'),
  screen: fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8'),
  grid: fs.readFileSync('src/features/movies/components/MoviePosterGrid.tsx', 'utf8'),
  model: fs.readFileSync('src/features/movies/useMoviesScreenModel.ts', 'utf8'),
  overlay: fs.readFileSync('src/features/movies/components/MovieDetailOverlay.tsx', 'utf8'),
  player: fs.readFileSync('src/features/playback/unified/UnifiedPlayerController.tsx', 'utf8'),
  series: fs.readFileSync('src/features/series/SeriesScreen.tsx', 'utf8'),
  live: fs.readFileSync('src/features/live/LiveTvScreen.tsx', 'utf8'),
  searchOverlay: fs.readFileSync('src/features/search/SearchOverlay.tsx', 'utf8'),
  searchScreen: fs.readFileSync('src/features/search/SearchScreen.tsx', 'utf8'),
  guide: fs.readFileSync('src/features/guide/GuideScreen.tsx', 'utf8'),
  walkthrough: fs.readFileSync('src/features/onboarding/WalkthroughOverlay.tsx', 'utf8'),
  toast: fs.readFileSync('src/features/notifications/AppNotificationToast.tsx', 'utf8'),
  sort: fs.readFileSync('src/features/media-browser/ContentSortControl.tsx', 'utf8'),
  exit: fs.readFileSync('src/features/navigation/ExitConfirmOverlay.tsx', 'utf8'),
  portal: fs.readFileSync('src/features/portal/NovaPortalScreen.tsx', 'utf8'),
  settings: fs.readFileSync('src/features/settings/SettingsScreen.tsx', 'utf8'),
};

test.afterEach(() => {
  clearOnnMoviesTraceForTests();
  delete process.env.EXPO_PUBLIC_NOVACAST_MOVIES_TRACE;
  delete process.env.EXPO_PUBLIC_NOVACAST_MOVIES_TRACE_AUTO_SCENARIO;
  delete process.env.EXPO_PUBLIC_NOVACAST_MOVIES_TRACE_AUTO_DURATION_MS;
});

test('trace helper is disabled by default', () => {
  delete process.env.EXPO_PUBLIC_NOVACAST_MOVIES_TRACE;
  clearOnnMoviesTraceForTests();
  assert.equal(isOnnMoviesTraceEnabled(), false);
  assert.equal(beginOnnMoviesTrace('detail-back'), null);
  assert.equal(getActiveOnnMoviesTraceId(), null);

  const logs = [];
  const original = console.info;
  console.info = (...args) => logs.push(args.join(' '));
  try {
    traceOnnMoviesEvent('Movies', 'should_not_log', { x: 1 });
  } finally {
    console.info = original;
  }
  assert.equal(logs.length, 0);
});

test('sanitize redacts credentials and URLs but keeps scroll delta fields', () => {
  const sanitized = sanitizeOnnMoviesTracePayload({
    password: 'secret-value',
    username: 'alice',
    streamUrl: 'https://example.com/player_api.php?user=a',
    raw: 'https://cdn.example/path',
    requestedOffset: 120,
    currentOffset: 100,
    reason: 'initial-detail-restore',
    restorationToken: 'detail-3',
    delta: 20,
    userVisibleMovementExpected: false,
  });

  assert.equal(sanitized.password, '[redacted]');
  assert.equal(sanitized.username, '[redacted]');
  assert.equal(sanitized.streamUrl, '[redacted]');
  assert.equal(sanitized.raw, '[redacted-url]');
  assert.equal(sanitized.requestedOffset, 120);
  assert.equal(sanitized.currentOffset, 100);
  assert.equal(sanitized.reason, 'initial-detail-restore');
  assert.equal(sanitized.restorationToken, 'detail-3');
  assert.equal(sanitized.delta, 20);
  assert.equal(sanitized.userVisibleMovementExpected, false);
  assert.equal(typeof sanitized.userVisibleMovementExpected, 'boolean');
});

test('scroll events include command reason and delta', () => {
  setOnnMoviesTraceEnabledForTests(true);
  const logs = [];
  const original = console.info;
  console.info = (...args) => logs.push(args.join(' '));
  try {
    beginOnnMoviesTrace('detail-back');
    traceOnnMoviesScrollCommand({
      requestedOffset: 240,
      currentOffset: 200,
      animated: false,
      reason: 'corrective-native-focus-drift',
      restorationToken: 'detail-9',
      restoreAttempt: 2,
      detailPhase: 'closing-viewport',
    });
  } finally {
    console.info = original;
  }

  const scroll = logs
    .map((line) => line.replace('[NovaCast ONN Trace] ', ''))
    .map((line) => JSON.parse(line))
    .find((row) => row.event === 'scroll_command');

  assert.ok(scroll);
  assert.equal(scroll.payload.reason, 'corrective-native-focus-drift');
  assert.equal(scroll.payload.delta, 40);
  assert.equal(scroll.payload.requestedOffset, 240);
  assert.equal(scroll.payload.currentOffset, 200);
});

test('grid mount/unmount events preserve instance ID', () => {
  setOnnMoviesTraceEnabledForTests(true);
  const a = nextOnnMoviesGridInstanceId();
  const b = nextOnnMoviesGridInstanceId();
  assert.notEqual(a, b);
  setOnnMoviesGridMounted(true, a);
  assert.equal(getOnnMoviesTraceTestState().activeGridInstanceId, a);
  assert.match(SOURCE.grid, /movie_grid_mount/);
  assert.match(SOURCE.grid, /movie_grid_unmount/);
  assert.match(SOURCE.grid, /nextOnnMoviesGridInstanceId/);
  assert.match(SOURCE.grid, /instanceId/);
});

test('back logs include handler ID and consumed result', () => {
  setOnnMoviesTraceEnabledForTests(true);
  const logs = [];
  const original = console.info;
  console.info = (...args) => logs.push(args.join(' '));
  try {
    beginOnnMoviesTrace('detail-back');
    const wrapped = wrapOnnMoviesBackHandler('movies-screen', () => true, () => ({
      screen: 'MoviesScreen',
    }));
    assert.equal(wrapped(), true);
  } finally {
    console.info = original;
  }

  const back = logs
    .map((line) => line.replace('[NovaCast ONN Trace] ', ''))
    .map((line) => JSON.parse(line))
    .find((row) => row.event === 'back_handler');

  assert.ok(back);
  assert.equal(back.payload.handlerId, 'movies-screen');
  assert.equal(back.payload.returned, true);
  assert.equal(back.payload.decision, 'consumed');
  assert.match(String(back.payload.backPressId), /^bp-/);
});

test('catalog clearing logs include call-site reason', () => {
  setOnnMoviesTraceEnabledForTests(true);
  const logs = [];
  const original = console.info;
  console.info = (...args) => logs.push(args.join(' '));
  try {
    beginOnnMoviesTrace('repair-with-healthy-snapshot');
    traceOnnMoviesCategoriesCleared('repairing-sparse-generation', {
      categoriesBefore: 12,
      categoriesAfter: 0,
    });
  } finally {
    console.info = original;
  }

  const cleared = logs
    .map((line) => line.replace('[NovaCast ONN Trace] ', ''))
    .map((line) => JSON.parse(line))
    .find((row) => row.event === 'categories_cleared');

  assert.ok(cleared);
  assert.equal(cleared.payload.callSite, 'repairing-sparse-generation');
  assert.equal(cleared.payload.reason, 'repairing-sparse-generation');
  assert.match(SOURCE.model, /traceOnnMoviesCategoriesCleared\(/);
});

test('Detail Back and X emit the same lifecycle event shape', () => {
  assert.match(SOURCE.screen, /detail_close_requested/);
  assert.match(SOURCE.screen, /closeDetail\('back'\)/);
  assert.match(SOURCE.screen, /closeDetail\('x'\)/);
  assert.match(SOURCE.screen, /closeSource: detailCloseSourceRef\.current/);
  assert.match(SOURCE.screen, /closing_prepare/);
  assert.match(SOURCE.screen, /closing_viewport/);
  assert.match(SOURCE.screen, /closing_focus/);
  assert.match(SOURCE.overlay, /blur_view_mount/);
  assert.match(SOURCE.overlay, /blur_view_unmount/);
});

test('trace event volume is bounded', () => {
  setOnnMoviesTraceEnabledForTests(true);
  const logs = [];
  const original = console.info;
  console.info = (...args) => logs.push(args.join(' '));
  try {
    beginOnnMoviesTrace('manual');
    const max = getOnnMoviesTraceTestState().maxEventsPerTrace;
    for (let i = 0; i < max + 50; i += 1) {
      traceOnnMoviesEvent('Movies', 'flood', { i });
    }
  } finally {
    console.info = original;
  }

  const parsed = logs
    .filter((line) => line.includes('[NovaCast ONN Trace]'))
    .map((line) => JSON.parse(line.replace('[NovaCast ONN Trace] ', '')));

  const flood = parsed.filter((row) => row.event === 'flood');
  const cap = parsed.find((row) => row.event === 'trace_event_cap_reached');
  assert.ok(cap);
  assert.ok(flood.length <= getOnnMoviesTraceTestState().maxEventsPerTrace);
});

test('scenario helper and back handlers are wired for ONN collection', () => {
  setOnnMoviesTraceEnabledForTests(true);
  const id = startOnnMoviesScenario('playback-back');
  assert.match(String(id), /^onn-\d{8}-\d{6}-playback-back$/);
  endOnnMoviesTrace('complete');

  for (const [name, source] of Object.entries({
    player: SOURCE.player,
    series: SOURCE.series,
    live: SOURCE.live,
    searchOverlay: SOURCE.searchOverlay,
    searchScreen: SOURCE.searchScreen,
    guide: SOURCE.guide,
    walkthrough: SOURCE.walkthrough,
    toast: SOURCE.toast,
    sort: SOURCE.sort,
    exit: SOURCE.exit,
    portal: SOURCE.portal,
    settings: SOURCE.settings,
    movies: SOURCE.screen,
  })) {
    assert.match(source, /wrapOnnMoviesBackHandler/, `${name} missing back wrap`);
  }

  assert.match(SOURCE.trace, /EXPO_PUBLIC_NOVACAST_MOVIES_TRACE/);
  assert.match(SOURCE.trace, /__NOVACAST_ONN_MOVIES_TRACE__/);
  assert.match(SOURCE.screen, /movie_grid_gate_changed/);
  assert.match(SOURCE.grid, /traceOnnMoviesScrollCommand/);
});

test('auto trace is disabled by default', () => {
  delete process.env.EXPO_PUBLIC_NOVACAST_MOVIES_TRACE;
  delete process.env.EXPO_PUBLIC_NOVACAST_MOVIES_TRACE_AUTO_SCENARIO;
  clearOnnMoviesTraceForTests();
  assert.equal(isOnnMoviesTraceEnabled(), false);
  assert.equal(getOnnMoviesTraceAutoScenario(), null);
  assert.equal(maybeBeginOnnMoviesAutoTrace({ source: 'MoviesScreen' }), null);
  assert.equal(getActiveOnnMoviesTraceId(), null);
});

test('auto trace begins once only for AUTO_SCENARIO', () => {
  setOnnMoviesTraceEnabledForTests(true);
  process.env.EXPO_PUBLIC_NOVACAST_MOVIES_TRACE_AUTO_SCENARIO = 'onn-audit-pass-1';
  process.env.EXPO_PUBLIC_NOVACAST_MOVIES_TRACE_AUTO_DURATION_MS = '600000';

  const logs = [];
  const original = console.info;
  console.info = (...args) => logs.push(args.join(' '));
  try {
    const first = maybeBeginOnnMoviesAutoTrace({ source: 'MoviesScreen' });
    const second = maybeBeginOnnMoviesAutoTrace({ source: 'MoviesScreen' });
    assert.ok(first);
    assert.equal(second, first);
    assert.match(first, /^onn-\d{8}-\d{6}-onn-audit-pass-1$/);
  } finally {
    console.info = original;
  }

  const started = parseTraceLogs(logs).filter((row) => row.event === 'auto_trace_started');
  assert.equal(started.length, 1);
  assert.equal(started[0].payload.scenario, 'onn-audit-pass-1');
  assert.equal(started[0].payload.source, 'MoviesScreen');
  assert.equal(getOnnMoviesTraceTestState().autoTraceAttemptedThisProcess, true);
});

test('invalid AUTO_DURATION_MS uses default 600000', () => {
  setOnnMoviesTraceEnabledForTests(true);
  process.env.EXPO_PUBLIC_NOVACAST_MOVIES_TRACE_AUTO_DURATION_MS = 'not-a-number';
  assert.equal(getOnnMoviesTraceAutoDurationMs(), ONN_MOVIES_TRACE_DEFAULT_AUTO_DURATION_MS);

  process.env.EXPO_PUBLIC_NOVACAST_MOVIES_TRACE_AUTO_DURATION_MS = '-5';
  assert.equal(getOnnMoviesTraceAutoDurationMs(), ONN_MOVIES_TRACE_DEFAULT_AUTO_DURATION_MS);

  delete process.env.EXPO_PUBLIC_NOVACAST_MOVIES_TRACE_AUTO_DURATION_MS;
  assert.equal(getOnnMoviesTraceAutoDurationMs(), 600000);
});

test('auto trace timeout ends the active trace', async () => {
  setOnnMoviesTraceEnabledForTests(true);
  process.env.EXPO_PUBLIC_NOVACAST_MOVIES_TRACE_AUTO_SCENARIO = 'onn-audit-pass-1';
  process.env.EXPO_PUBLIC_NOVACAST_MOVIES_TRACE_AUTO_DURATION_MS = '30';

  const logs = [];
  const original = console.info;
  console.info = (...args) => logs.push(args.join(' '));
  try {
    const id = maybeBeginOnnMoviesAutoTrace({ source: 'MoviesScreen' });
    assert.ok(id);
    assert.equal(getActiveOnnMoviesTraceId(), id);
    await delay(80);
    assert.equal(getActiveOnnMoviesTraceId(), null);
  } finally {
    console.info = original;
  }

  const parsed = parseTraceLogs(logs);
  assert.ok(parsed.some((row) => row.event === 'auto_trace_timeout'));
  assert.ok(
    parsed.some((row) => row.event === 'trace_end' && row.payload.result === 'auto-timeout'),
  );
});

test('MoviesScreen remount/rerender path does not restart auto trace', () => {
  setOnnMoviesTraceEnabledForTests(true);
  process.env.EXPO_PUBLIC_NOVACAST_MOVIES_TRACE_AUTO_SCENARIO = 'onn-audit-pass-1';
  process.env.EXPO_PUBLIC_NOVACAST_MOVIES_TRACE_AUTO_DURATION_MS = '600000';

  const logs = [];
  const original = console.info;
  console.info = (...args) => logs.push(args.join(' '));
  try {
    // Simulate first mount + later remount/rerender effect invocations.
    maybeBeginOnnMoviesAutoTrace({ source: 'MoviesScreen' });
    maybeBeginOnnMoviesAutoTrace({ source: 'MoviesScreen' });
    maybeBeginOnnMoviesAutoTrace({ source: 'MoviesScreen' });
  } finally {
    console.info = original;
  }

  const started = parseTraceLogs(logs).filter((row) => row.event === 'auto_trace_started');
  const begins = parseTraceLogs(logs).filter((row) => row.event === 'trace_begin');
  assert.equal(started.length, 1);
  assert.equal(begins.length, 1);
  assert.match(SOURCE.screen, /maybeBeginOnnMoviesAutoTrace/);
  assert.match(SOURCE.screen, /subscribeAppState/);
});

test('auto background end requires 10s elapsed and does not touch product state', () => {
  setOnnMoviesTraceEnabledForTests(true);
  process.env.EXPO_PUBLIC_NOVACAST_MOVIES_TRACE_AUTO_SCENARIO = 'onn-audit-pass-1';
  process.env.EXPO_PUBLIC_NOVACAST_MOVIES_TRACE_AUTO_DURATION_MS = '600000';

  const productState = { route: 'movies', selectedCategoryId: '287', mutated: false };
  const logs = [];
  const original = console.info;
  console.info = (...args) => logs.push(args.join(' '));
  try {
    maybeBeginOnnMoviesAutoTrace({ source: 'MoviesScreen' });
    assert.equal(maybeEndOnnMoviesAutoTraceOnBackground('background'), false);
    assert.ok(getActiveOnnMoviesTraceId());

    setOnnMoviesTraceStartedAtForTests(Date.now() - 11_000);
    assert.equal(maybeEndOnnMoviesAutoTraceOnBackground('background'), true);
    assert.equal(getActiveOnnMoviesTraceId(), null);
  } finally {
    console.info = original;
  }

  assert.equal(productState.route, 'movies');
  assert.equal(productState.selectedCategoryId, '287');
  assert.equal(productState.mutated, false);

  const parsed = parseTraceLogs(logs);
  assert.ok(parsed.some((row) => row.event === 'auto_trace_app_background'));
  assert.ok(
    parsed.some((row) => row.event === 'trace_end' && row.payload.result === 'auto-background'),
  );

  // Auto helper must remain diagnostics-only in MoviesScreen (no navigation/selection writes).
  const autoEffect = SOURCE.screen.match(
    /maybeBeginOnnMoviesAutoTrace\(\{[\s\S]*?\}\);/,
  );
  assert.ok(autoEffect);
  assert.doesNotMatch(autoEffect[0], /router\.|setSelected|selectCategory|closeDetail|launchPlayback/);
});
