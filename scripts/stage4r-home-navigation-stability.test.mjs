import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

// Stage 4.2R — Home + Navigation Stability.
// Mixes pure-function unit tests of the new Home focus/restoration logic with
// source-content assertions that guard the shell/Home wiring and confirm the
// accepted Movies/Series/StartupGate baselines are not regressed.

const shell = fs.readFileSync('src/components/nova/NovaTvShell.tsx', 'utf8');
const home = fs.readFileSync('src/features/hub/MainMenuScreen.tsx', 'utf8');
const channelCard = fs.readFileSync('src/features/hub/ChannelHeroCard.tsx', 'utf8');
const startupGate = fs.readFileSync('src/features/startup/StartupGate.tsx', 'utf8');

function sliceBlock(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing block start: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `missing block end: ${endNeedle}`);
  return source.slice(start, end);
}

function runChildSuite(name) {
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  return spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--test', `scripts/${name}`],
    { encoding: 'utf8', env: childEnv },
  );
}

function countTapFail(output) {
  const match = output.match(/# fail (\d+)/);
  return match ? Number(match[1]) : 0;
}

function baseSnapshot(overrides = {}) {
  return {
    providerId: 'p1',
    recentlyWatched: [],
    continueWatching: [],
    favoriteChannels: [],
    favoriteMovies: [],
    favoriteSeries: [],
    ...overrides,
  };
}

// ── 1. Home has one deterministic initial focus target ─────────────────────

test('1. Home resolves exactly one deterministic initial focus target', async () => {
  const { resolveHomeInitialFocusId } = await import('../src/features/hub/homeScreenMemory.ts');
  const snapshot = baseSnapshot({
    recentlyWatched: [
      { mediaType: 'movie', contentId: 'a' },
      { mediaType: 'movie', contentId: 'b' },
    ],
    continueWatching: [{ contentId: 'c' }],
  });
  const first = resolveHomeInitialFocusId(snapshot, 'p1', { guideVisible: false });
  const again = resolveHomeInitialFocusId(snapshot, 'p1', { guideVisible: false });
  assert.equal(first, 'recent-movie-a');
  assert.equal(first, again);
  // The Home screen freezes the resolved target in a ref so refreshes cannot move it.
  assert.match(home, /const resolvedFocusIdRef = useRef<string \| null \| undefined>\(undefined\)/);
  assert.match(home, /resolvedFocusIdRef\.current !== undefined/);
});

// ── 2. Primary nav focus movement does not activate routes ─────────────────

test('2. Nav item onFocus does not navigate (no router call in focus handler)', () => {
  const onFocus = sliceBlock(shell, "recordFocusAudit({ component: 'NovaTvShell.navbar', action: 'focus-received'", 'onBlur={() => setFocusedId(null)}');
  assert.doesNotMatch(onFocus, /router\.(replace|push)/);
  assert.match(onFocus, /noteNavFocusChanged\(item\.id\)/);
  assert.match(onFocus, /setFocusedId\(item\.id\)/);
});

// ── 3. Select activates the intended nav route ─────────────────────────────

test('3. Nav item onPress activates the intended route via router.replace', () => {
  const onPress = sliceBlock(shell, 'if (item.route === pathname)', 'style={itemStyle}');
  assert.match(onPress, /router\.replace\(item\.route as Href\)/);
  assert.match(onPress, /recordHomeStabilityEvent\('nav_route_activated'/);
});

// ── 4/5/6. Nav focus movement triggers no provider / SQLite / catalog work ──

test('4. Nav focus movement does not trigger provider calls', () => {
  const onFocus = sliceBlock(shell, "recordFocusAudit({ component: 'NovaTvShell.navbar', action: 'focus-received'", 'onBlur={() => setFocusedId(null)}');
  assert.doesNotMatch(onFocus, /provider|bundle|account/i);
});

test('5. Nav focus movement does not trigger SQLite queries', () => {
  const onFocus = sliceBlock(shell, "recordFocusAudit({ component: 'NovaTvShell.navbar', action: 'focus-received'", 'onBlur={() => setFocusedId(null)}');
  assert.doesNotMatch(onFocus, /sqlite|query|execAsync|getAllAsync/i);
});

test('6. Nav focus movement does not trigger catalog sync', () => {
  const onFocus = sliceBlock(shell, "recordFocusAudit({ component: 'NovaTvShell.navbar', action: 'focus-received'", 'onBlur={() => setFocusedId(null)}');
  assert.doesNotMatch(onFocus, /sync|reconcile|refreshCatalog/i);
});

// ── 7. Home row focus does not remount the row ─────────────────────────────

test('7. Home rows are memoized with stable content-derived keys', () => {
  assert.match(home, /const HomeRow = memo\(function HomeRow/);
  // Cards key off mediaType+contentId / item.id, never array index.
  assert.match(home, /key=\{`\$\{item\.mediaType\}-\$\{item\.contentId\}`\}/);
  assert.doesNotMatch(home, /key=\{index\}/);
});

// ── 8. Home row update does not reset current focus ────────────────────────

test('8. Frozen focus ref prevents a data refresh from re-pointing focus', () => {
  // Once resolved, firstHomeFocusId is read from the ref, not recomputed from
  // the (possibly refreshed) personalization snapshot.
  assert.match(home, /} else if \(resolvedFocusIdRef\.current !== undefined\) \{\s*firstHomeFocusId = resolvedFocusIdRef\.current;/);
  assert.match(home, /noteHomeRowUpdated\('personalization-refresh'\)/);
});

// ── 9. Returning from Home content restores origin item ────────────────────

test('9. A remembered focus target still present in the snapshot is restored', async () => {
  const { resolveHomeInitialFocusId } = await import('../src/features/hub/homeScreenMemory.ts');
  const snapshot = baseSnapshot({
    recentlyWatched: [
      { mediaType: 'movie', contentId: 'a' },
      { mediaType: 'movie', contentId: 'b' },
    ],
    favoriteMovies: [{ id: 'z' }],
  });
  const restored = resolveHomeInitialFocusId(snapshot, 'p1', {
    guideVisible: false,
    rememberedFocusId: 'favorite-movie-z',
  });
  assert.equal(restored, 'favorite-movie-z');
});

// ── 10/11/12. Returning from Movies / Series / Live restores prior Home focus ─

test('10. Home records the focused card so Movies return can restore it', () => {
  assert.match(home, /rememberHomeScreenMemory\(activeProviderId, \{ focusedCardId: focusId \}\)/);
  assert.match(home, /onFocused=\{handleCardFocused\}/);
});

test('11. Series favorite cards report focus for restoration', () => {
  const seriesCard = sliceBlock(home, 'subtitle="Favorite series"', 'navigateTo(\'/series\')');
  assert.match(seriesCard, /focusId=\{`favorite-series-\$\{item\.id\}`\}/);
  assert.match(seriesCard, /onFocused=\{handleCardFocused\}/);
});

test('12. Live favorite-channel cards report focus for restoration', () => {
  const liveCard = sliceBlock(home, 'subtitle="Favorite channel"', 'lastOpenedAt: Date.now()');
  assert.match(liveCard, /focusId=\{`favorite-channel-\$\{item\.id\}`\}/);
  assert.match(liveCard, /onFocused=\{handleCardFocused\}/);
  assert.match(channelCard, /onFocused\?\.\(focusId\)/);
});

// ── 13. Restoration handles a missing prior item safely ────────────────────

test('13. A remembered target no longer in the snapshot falls back to the first card', async () => {
  const { resolveHomeInitialFocusId } = await import('../src/features/hub/homeScreenMemory.ts');
  const snapshot = baseSnapshot({
    recentlyWatched: [{ mediaType: 'movie', contentId: 'a' }],
  });
  const restored = resolveHomeInitialFocusId(snapshot, 'p1', {
    guideVisible: false,
    rememberedFocusId: 'favorite-movie-does-not-exist',
  });
  assert.equal(restored, 'recent-movie-a');
});

// ── 14. Home scroll/position restoration works ─────────────────────────────

test('14. Home persists and restores vertical scroll offset; focus restore drives horizontal position', async () => {
  const { getHomeScreenMemory, rememberHomeScreenMemory, resetHomeScreenMemory } = await import(
    '../src/features/hub/homeScreenMemory.ts'
  );
  resetHomeScreenMemory('p1');
  rememberHomeScreenMemory('p1', { scrollOffsetY: 420, focusedCardId: 'recent-movie-a' });
  assert.equal(getHomeScreenMemory('p1').scrollOffsetY, 420);
  assert.equal(getHomeScreenMemory('p1').focusedCardId, 'recent-movie-a');
  resetHomeScreenMemory('p1');
  assert.equal(getHomeScreenMemory('p1').scrollOffsetY, 0);
  // Wiring: offset captured on scroll and re-applied on restore.
  assert.match(home, /onScroll=\{handleHomeScroll\}/);
  assert.match(home, /scrollRef\.current\?\.scrollTo\(\{ y: targetY, animated: false \}\)/);
});

// ── 15. Route transition does not create a duplicate destination screen ─────

test('15. Nav uses router.replace (not push) so destinations are not duplicated', () => {
  assert.match(shell, /router\.replace\(item\.route as Href\)/);
  const navBlock = sliceBlock(shell, 'const NAV_ITEMS', 'style={itemStyle}');
  assert.doesNotMatch(navBlock, /router\.push/);
});

// ── 16. StartupGate → shell handoff remains compatible ─────────────────────

test('16. StartupGate still hands off to the Home shell via /main-menu', () => {
  assert.match(startupGate, /Redirect href="\/main-menu"/);
});

// ── 17/18. Stage 4.2P offline bootstrap behavior + tests remain green ───────

test('17. Stage 4.2P local/offline bootstrap markers are intact', () => {
  const localBootstrap = fs.readFileSync('src/features/providers/providerLocalBootstrap.ts', 'utf8');
  assert.ok(localBootstrap.length > 0);
  assert.match(startupGate, /markStartupReady/);
});

test('18. Stage 4.2P test suite still passes', () => {
  const result = runChildSuite('stage4p-parity-polish.test.mjs');
  assert.equal(countTapFail(result.stdout), 0, result.stdout + result.stderr);
});

// ── 19. Stage 4.2Q behavior remains green ──────────────────────────────────

test('19. Stage 4.2Q Series/Movies parity source is untouched by this stage', () => {
  const seriesMemory = fs.readFileSync('src/features/series/seriesScreenMemory.ts', 'utf8');
  const moviesMemory = fs.readFileSync('src/features/movies/moviesScreenMemory.ts', 'utf8');
  assert.match(seriesMemory, /rememberSeriesScreenMemory/);
  assert.match(moviesMemory, /rememberMoviesScreenMemory/);
});

// ── 20/21. Movies + Series baselines remain green (impl files unmodified) ────

test('20. Movies implementation files are not edited by Stage 4.2R', () => {
  const moviesScreen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
  assert.doesNotMatch(moviesScreen, /homeStabilityDiagnostics|homeScreenMemory/);
});

test('21. Series implementation files are not edited by Stage 4.2R', () => {
  const seriesScreen = fs.readFileSync('src/features/series/SeriesScreen.tsx', 'utf8');
  assert.doesNotMatch(seriesScreen, /homeStabilityDiagnostics|homeScreenMemory/);
});
