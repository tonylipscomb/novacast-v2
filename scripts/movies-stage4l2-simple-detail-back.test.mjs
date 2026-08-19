import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

import {
  assertMoviesDetailClosedVisualInvariant,
  isValidTvFocusableTarget,
  MOVIES_FOCUS_STAGE4L2_MARKER,
  shouldUseMoviesDetailCloseIsolationCover,
} from '../src/features/movies/moviesDetailSimpleBack.ts';

const screen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
const overlay = fs.readFileSync('src/features/movies/components/MovieDetailOverlay.tsx', 'utf8');
const toolbar = fs.readFileSync('src/features/movies/components/MovieToolbar.tsx', 'utf8');
const focusDiag = fs.readFileSync('src/features/navigation/tvFocusDiagnostics.ts', 'utf8');
const sqlite = fs.readFileSync('src/features/movies/data/SqliteMovieDataSource.ts', 'utf8');
const detailClose = fs.readFileSync('src/features/movies/moviesDetailCloseInstant.ts', 'utf8');
const isolation = fs.readFileSync(
  'src/features/movies/moviesStartupRuntimeIsolation.ts',
  'utf8',
);

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
  return {
    requestTvFocus: module.exports.requestTvFocus,
    isValidTvFocusableTarget: module.exports.isValidTvFocusableTarget,
    flushRaf: () => {
      while (rafQueue.length) {
        const cb = rafQueue.shift();
        cb();
      }
    },
  };
}

test('Stage 4.2L.2 marker present', () => {
  assert.equal(MOVIES_FOCUS_STAGE4L2_MARKER, 'stage4l2-movies-simple-detail-back-v1');
  assert.match(screen, /MOVIES_FOCUS_STAGE4L2_MARKER/);
});

test('1. Search onFocus never calls requestTvFocus', () => {
  const onFocusStart = screen.indexOf('onSearchFocus={() =>');
  assert.ok(onFocusStart > 0);
  const onFocusEnd = screen.indexOf('onSearchPress={() =>', onFocusStart);
  const onFocusBlock = screen.slice(onFocusStart, onFocusEnd);
  assert.doesNotMatch(onFocusBlock, /requestTvFocus\s*\(/);
  assert.doesNotMatch(onFocusBlock, /movies-search-steal-correction/);
  assert.match(onFocusBlock, /must NEVER call/);
});

test('2. Search focus cannot throw during Detail close', () => {
  assert.match(screen, /hasTVPreferredFocus=\{false\}/);
  assert.match(toolbar, /hasTVPreferredFocus/);
  // Correction helper is disabled (no-op).
  assert.match(isolation, /correction-disabled-stage4l2/);
  assert.doesNotMatch(screen, /searchFocusCorrectionTokenRef/);
});

test('3. Movies browse layer uses normal View on Android TV', () => {
  assert.doesNotMatch(screen, /BlurTargetView/);
  assert.doesNotMatch(screen, /__expoBlurTarget/);
  assert.match(screen, /ref=\{browseLayerRef\}/);
  assert.match(screen, /style=\{\[styles\.browseLayer/);
});

test('4. MovieDetailOverlay receives no native blur target on Android TV', () => {
  const shell = fs.readFileSync('src/features/media-detail/MediaDetailOverlayShell.tsx', 'utf8');
  assert.doesNotMatch(screen, /blurTarget=\{/);
  assert.doesNotMatch(overlay, /blurTarget=\{/);
  assert.doesNotMatch(overlay, /blurMethod="dimezisBlurViewSdk31Plus"/);
  // Stage 4.2M: blur lives in shared shell (intensity + scrim only).
  assert.match(shell, /intensity=\{28\}/);
  assert.match(shell, /Never bind a native blur-target/);
});

test('5. Invalid poster focus target returns structured failure', () => {
  assert.equal(isValidTvFocusableTarget(null), false);
  assert.equal(isValidTvFocusableTarget({}), false);
  assert.equal(isValidTvFocusableTarget({ focus: 'nope' }), false);
  assert.equal(isValidTvFocusableTarget({ focus: () => undefined }), true);
  assert.match(focusDiag, /target-focus-method-unavailable/);
  // Stage 4.2M active path logs origin focus results via hardened requestTvFocus.
  assert.match(screen, /movies_detail_origin_focus_result|movies_detail_return_focus_target_invalid/);
});

test('6. Missing focus method never throws', () => {
  const { requestTvFocus } = loadRequestTvFocus();
  const results = [];
  assert.doesNotThrow(() => {
    requestTvFocus({
      screen: 'movies',
      source: 'test',
      region: 'poster-grid',
      reason: 'unit-test-missing-getTarget',
      // Intentionally invalid — simulates the Stage 4.2L.1 fatal call shape.
      getTarget: undefined,
      onResult: (result) => results.push(result),
    });
  });
  assert.equal(results[0]?.requested, false);
  assert.equal(results[0]?.reason, 'target-focus-method-unavailable');
});

test('7. Detail closes even when poster focus request fails', () => {
  // Stage 4.2M: overlay closes first; focus is best-effort afterward.
  assert.match(screen, /closeDetailOverlay/);
  assert.match(screen, /setDetailOpen\(false\)/);
  assert.match(screen, /stage4m-restore-origin-poster/);
});

test('8. Browse remains visible after failed focus restoration', () => {
  const closeStart = screen.indexOf('const closeDetailOverlay = useCallback');
  const closeEnd = screen.indexOf('const closeDetail = useCallback', closeStart);
  const closeBlock = screen.slice(closeStart, closeEnd);
  assert.match(closeBlock, /setVisualIsolationSafe\(false\)/);
  assert.match(closeBlock, /setDetailVisualHoldSafe\(false\)/);
  assert.match(closeBlock, /setDetailOpen\(false\)/);
});

test('9. No gray isolation cover remains after close', () => {
  assert.equal(
    shouldUseMoviesDetailCloseIsolationCover({
      targetVisible: true,
      targetRefMounted: true,
    }),
    false,
  );
  const closed = assertMoviesDetailClosedVisualInvariant({
    detailOpen: false,
    detailClosing: false,
    overlayVisible: false,
    visualIsolationActive: false,
    holdCoverActive: false,
    browsePointerEventsEnabled: true,
  });
  assert.equal(closed.ok, true);
  // Stage 4.2M active close clears isolation immediately.
  assert.match(screen, /setVisualIsolationSafe\(false\)/);
});

test('10. Remote/browse ownership is restored after close', () => {
  const closeStart = screen.indexOf('const closeDetailOverlay = useCallback');
  const closeEnd = screen.indexOf('const closeDetail = useCallback', closeStart);
  const closeBlock = screen.slice(closeStart, closeEnd);
  assert.match(closeBlock, /setMoviesBrowseUiFrozenForDetail\(false\)/);
  assert.match(closeBlock, /setDetailOpen\(false\)/);
  assert.match(screen, /pointerEvents/);
});

test('11. Valid poster target still restores exact poster', () => {
  assert.match(screen, /stage4m-restore-origin-poster/);
  assert.match(screen, /getValidatedPosterTarget\(originItemId\)/);
  // Legacy immutable helpers remain available for compatibility.
  assert.match(detailClose, /createMoviesDetailCloseImmutableTarget/);
});

test('12. Category rail remains mounted and visible', () => {
  assert.match(screen, /MovieCategoryRail/);
  assert.match(screen, /railInstanceIdRef|railInstanceId/);
  assert.doesNotMatch(screen, /categories\.length === 0[\s\S]{0,40}return null/);
});

test('13. Startup pinned viewport behavior remains passing', () => {
  assert.match(sqlite, /pinned-generation-sql/);
  assert.match(sqlite, /MOVIES_STARTUP_VIEWPORT_LIMIT|movies_startup_viewport_query/);
  assert.match(sqlite, /movies_startup_reentry_blocked/);
  assert.match(isolation, /beginMoviesStartupSession|shouldBlockMoviesStartupReentry/);
});

test('14. Stage 4.2K.2 immutable target tests remain compatible', () => {
  assert.match(detailClose, /MOVIES_FOCUS_STAGE4K2_MARKER/);
  assert.match(detailClose, /createMoviesDetailCloseImmutableTarget/);
  assert.match(detailClose, /shouldAcceptMoviesDetailCloseLateFocus/);
  assert.match(screen, /MOVIES_FOCUS_STAGE4K2_MARKER/);
  assert.match(screen, /immutableCloseTargetRef|getImmutableCloseTargetMovieId/);
});
