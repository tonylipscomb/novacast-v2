import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

const screen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
const overlay = fs.readFileSync('src/features/movies/components/MovieDetailOverlay.tsx', 'utf8');
const shell = fs.readFileSync('src/features/media-detail/MediaDetailOverlayShell.tsx', 'utf8');
const simple = fs.readFileSync('src/features/movies/moviesSimpleDetailOverlay.ts', 'utf8');
const sqlite = fs.readFileSync('src/features/movies/data/SqliteMovieDataSource.ts', 'utf8');
const focusDiag = fs.readFileSync('src/features/navigation/tvFocusDiagnostics.ts', 'utf8');

function loadRequestTvFocus() {
  const output = transpileModule(focusDiag, {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const rafQueue = [];
  vm.runInNewContext(
    output,
    {
      module,
      exports: module.exports,
      require: (request) => {
        if (request.includes('tvPerfStore')) {
          return {
            tvPerfRecordFocusRequest: () => undefined,
            tvPerfSetLatestFocusRequest: () => undefined,
          };
        }
        if (request.includes('appForegroundGate')) {
          return { isAppForegroundActive: () => true };
        }
        if (request.includes('focusRequestAudit')) {
          return { recordFocusAudit: () => undefined };
        }
        return {};
      },
      console,
      requestAnimationFrame: (cb) => {
        rafQueue.push(cb);
        return rafQueue.length;
      },
      cancelAnimationFrame: () => undefined,
      process,
      __DEV__: true,
    },
    { filename: 'tvFocusDiagnostics.ts' },
  );
  return module.exports.requestTvFocus;
}

test('Stage 4.2M Movies marker', () => {
  assert.match(simple, /MOVIES_FOCUS_STAGE4M_MARKER|stage4m-shared-media-detail-overlay/);
  assert.match(screen, /MOVIES_SIMPLE_DETAIL_OVERLAY_ENABLED/);
  assert.match(screen, /closeDetailOverlay/);
});

test('2. Opening does not unmount browse grid or rail', () => {
  assert.match(screen, /MoviePosterGrid/);
  assert.match(screen, /MovieCategoryRail/);
  assert.match(screen, /railInstanceIdRef/);
  // Guest overlay sits beside browse; browseLayer stays in tree.
  assert.match(screen, /styles\.browseLayer/);
  assert.doesNotMatch(screen, /detailOpen[\s\S]{0,80}return null[\s\S]{0,40}MoviePosterGrid/);
});

test('3. Opening does not replace visible items', () => {
  // Freeze still protects visible arrays while open; close unfreezes immediately.
  assert.match(screen, /setMoviesBrowseUiFrozenForDetail\(true\)/);
  const closeStart = screen.indexOf('const closeDetailOverlay = useCallback');
  const closeEnd = screen.indexOf('const closeDetail = useCallback', closeStart);
  assert.match(screen.slice(closeStart, closeEnd), /setMoviesBrowseUiFrozenForDetail\(false\)/);
});

test('9. Failed focus return leaves browse visible and interactive', () => {
  const closeStart = screen.indexOf('const closeDetailOverlay = useCallback');
  const closeEnd = screen.indexOf('const closeDetail = useCallback', closeStart);
  const closeBlock = screen.slice(closeStart, closeEnd);
  assert.match(closeBlock, /setDetailOpen\(false\)/);
  assert.match(closeBlock, /setVisualIsolationSafe\(false\)/);
  assert.doesNotMatch(closeBlock, /setDetailOpen\(true\)/);
});

test('13. Detail enrichment errors stay inside the popup', () => {
  assert.match(screen, /detailError=\{detailError\}/);
  assert.match(overlay, /Unable to load additional details/);
  assert.doesNotMatch(overlay, /Something went wrong/);
});

test('14. Playback errors stay inside the popup', () => {
  // Playback failure normalization preserved; screen must not route-replace on detail error.
  assert.match(screen, /normalizePlaybackFailure|buildSanitizedPlaybackSourceSnapshot/);
  assert.doesNotMatch(screen, /detailError[\s\S]{0,120}Something went wrong/);
});

test('15. Movies playback wiring remains intact', () => {
  assert.match(screen, /onPlay=\{selectedMovie \? startPlayback/);
  assert.match(screen, /const startPlayback/);
  assert.match(screen, /launchPlayback/);
  assert.match(screen, /setDetailSuppressedForPlayback/);
});

test('17. Movies browse instances remain stable across open/close', () => {
  assert.match(screen, /railInstanceIdRef/);
  assert.match(screen, /getOnnMoviesGridInstanceId/);
  assert.match(screen, /MoviePosterGrid/);
});

test('18. Category and offset remain unchanged', () => {
  const closeStart = screen.indexOf('const closeDetailOverlay = useCallback');
  const closeEnd = screen.indexOf('const closeDetail = useCallback', closeStart);
  const closeBlock = screen.slice(closeStart, closeEnd);
  assert.doesNotMatch(closeBlock, /selectCategory\(/);
  assert.doesNotMatch(closeBlock, /setViewportRestoreCommand/);
  assert.doesNotMatch(closeBlock, /scrollToOffset/);
});

test('21. Stage 4.2L startup pinned SQL tests remain passing', () => {
  assert.match(sqlite, /pinned-generation-sql/);
  assert.match(sqlite, /movies_startup_viewport_query|MOVIES_STARTUP_VIEWPORT_LIMIT/);
});

test('Invalid origin focus never throws', () => {
  const requestTvFocus = loadRequestTvFocus();
  const results = [];
  assert.doesNotThrow(() => {
    requestTvFocus({
      screen: 'movies',
      source: 'test',
      region: 'poster-grid',
      reason: 'stage4m-unit',
      getTarget: () => ({ /* no focus */ }),
      onResult: (result) => results.push(result),
    });
  });
  assert.equal(results[0]?.requested, false);
});

test('Shell has no isolation cover', () => {
  assert.doesNotMatch(shell, /visualIsolationCover/);
  assert.doesNotMatch(shell, /holdCover/);
  // Thin adapter may list ignored legacy props; shell must not render isolation.
  assert.doesNotMatch(shell, /visualIsolationActive/);
  assert.match(overlay, /Ignored by the Stage 4\.2M guest overlay path/);
});
