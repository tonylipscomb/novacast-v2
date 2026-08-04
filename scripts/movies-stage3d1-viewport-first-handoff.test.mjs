import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  isMoviesDetailClosingPhase,
  isMoviesFocusSuppressionActive,
  isMoviesViewportOffsetStable,
  MOVIES_FOCUS_SUPPRESSION_RELEASE_MS,
  MOVIES_MAX_FOCUS_REQUESTS,
  MOVIES_MAX_VIEWPORT_RESTORES,
  MOVIES_VIEWPORT_OFFSET_TOLERANCE_PX,
  shouldSuppressMoviesSearchFocus,
  wasMoviesSnapshotTargetVisible,
  createMoviesBrowseFocusSnapshot,
  isMoviesBrowseSnapshotImmutable,
  isMoviesDetailFocusConfirmed,
} from '../src/features/movies/moviesDetailFocusLifecycle.ts';

const screen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
const grid = fs.readFileSync('src/features/movies/components/MoviePosterGrid.tsx', 'utf8');
const lifecycle = fs.readFileSync('src/features/movies/moviesDetailFocusLifecycle.ts', 'utf8');
const toolbar = fs.readFileSync('src/features/movies/components/MovieToolbar.tsx', 'utf8');
const repository = fs.readFileSync('src/features/catalog/catalogRepository.ts', 'utf8');
const sqlite = fs.readFileSync('src/features/movies/data/SqliteMovieDataSource.ts', 'utf8');

test('1. Detail-open snapshot is immutable and includes relative row/column', () => {
  const snapshot = createMoviesBrowseFocusSnapshot({
    categoryId: 'c1',
    movieId: 'm100',
    movieIndex: 115,
    verticalOffset: 4319.5,
    visibleFirstIndex: 100,
    visibleLastIndex: 120,
    columns: 5,
  });
  assert.equal(wasMoviesSnapshotTargetVisible(snapshot), true);
  assert.equal(snapshot.targetRelativeRow, 3);
  assert.equal(snapshot.targetRelativeColumn, 0);
  assert.equal(isMoviesBrowseSnapshotImmutable('detail-open'), true);
  assert.equal(isMoviesBrowseSnapshotImmutable('closing-viewport'), true);
  assert.match(screen, /Immutable snapshot taken immediately before opening detail/);
  assert.match(screen, /Snapshot is immutable while detail is open or closing/);
});

test('2. Viewport restore occurs before poster focus', () => {
  assert.match(lifecycle, /closing-viewport/);
  assert.match(screen, /setDetailFocusPhaseSafe\('closing-viewport'\)/);
  assert.match(screen, /setDetailFocusPhaseSafe\('closing-focus'\)/);
  assert.match(screen, /Never transfer poster focus until the saved offset is stable/);
  // Stage 4.2F: fallback path keeps double-rAF settle; fast path skips initial restore.
  assert.match(screen, /Double-rAF settle gate/);
  assert.match(screen, /shouldIssueMoviesInitialDetailRestore|fast-mounted-target/);
  assert.match(grid, /reason: 'initial'/);
});

test('3. Exact saved offset is used via scrollToOffset', () => {
  assert.match(grid, /scrollToOffset\(\{ offset, animated: false \}\)/);
  assert.match(screen, /offset: snapshot\.verticalOffset/);
  // Stage 4.2F: fallback still restores saved offset; fast path corrects after focus.
  assert.match(screen, /Fallback: restore saved offset once before focus|covered_corrective_scroll/);
});

test('4. Native offset drift after focus triggers one correction', () => {
  assert.equal(MOVIES_MAX_VIEWPORT_RESTORES, 2);
  assert.equal(MOVIES_MAX_FOCUS_REQUESTS, 2);
  assert.equal(MOVIES_VIEWPORT_OFFSET_TOLERANCE_PX, 12);
  assert.match(screen, /reason: 'corrective'/);
  assert.match(grid, /detail-restoration-corrective-offset/);
  assert.match(lifecycle, /logMoviesViewportLock/);
  assert.equal(
    isMoviesViewportOffsetStable({ currentOffset: 3951, snapshotOffset: 4319.5 }),
    false,
  );
});

test('5. Restoration does not complete until focus and offset both confirm', () => {
  assert.match(screen, /Do not complete on focus alone/);
  assert.equal(
    isMoviesDetailFocusConfirmed({
      actuallyFocusedMovieId: 'm1',
      targetMovieId: 'm1',
      targetIndex: 115,
      visibleFirstIndex: 100,
      visibleLastIndex: 120,
      highlightVisible: true,
      currentOffset: 3951,
      snapshotOffset: 4319.5,
      snapshotTargetWasVisible: true,
    }),
    false,
  );
  assert.equal(
    isMoviesDetailFocusConfirmed({
      actuallyFocusedMovieId: 'm1',
      targetMovieId: 'm1',
      targetIndex: 115,
      visibleFirstIndex: 100,
      visibleLastIndex: 120,
      highlightVisible: true,
      currentOffset: 4319.5,
      snapshotOffset: 4319.5,
      snapshotTargetWasVisible: true,
    }),
    true,
  );
});

test('6. Visible targets are not aligned to the top row', () => {
  assert.doesNotMatch(grid, /viewPosition\s*:/);
  assert.doesNotMatch(grid, /scrollToIndex/);
  assert.match(grid, /method: 'scrollToOffset'/);
  assert.match(grid, /Never top-row-align/);
  assert.match(lifecycle, /targetRelativeRow/);
});

test('7. Search cannot claim preferred focus during close', () => {
  for (const phase of ['closing-prepare', 'closing-viewport', 'closing-focus', 'closing-confirm', 'browse-restored']) {
    assert.equal(shouldSuppressMoviesSearchFocus(phase), true);
  }
  assert.equal(shouldSuppressMoviesSearchFocus('browse'), false);
  assert.match(toolbar, /focusable\?: boolean/);
  // Stage 3D.2: focusability is separate from preferred; Search preferred stays false.
  assert.match(screen, /hasTVPreferredFocus=\{false\}/);
  assert.match(screen, /searchPreferredSuppressed|navbarPreferredSuppressed/);
});

test('8. Navbar\/category cannot claim preferred focus during close', () => {
  for (const phase of ['closing-prepare', 'closing-viewport', 'closing-focus', 'closing-confirm', 'browse-restored']) {
    assert.equal(isMoviesFocusSuppressionActive(phase), true);
  }
  assert.match(screen, /suppressNavbarPreferredFocus=\{navbarPreferredSuppressed\}/);
  assert.match(screen, /suppressPreferredFocus=\{categoryPreferredSuppressed\}/);
});

test('9. Highlight remains visible after overlay removal', () => {
  assert.match(screen, /Keep closingFocusMovieId until latch owns preferred\/highlight pin/);
  assert.match(screen, /setClosingFocusMovieId\(null\)/);
  assert.match(screen, /MOVIES_FOCUS_SUPPRESSION_RELEASE_MS/);
  assert.match(screen, /pinnedHighlightMovieId/);
});

test('10. No more than two focus requests occur', () => {
  assert.equal(MOVIES_MAX_FOCUS_REQUESTS, 2);
  assert.match(screen, /focusRequestCountRef/);
  assert.match(screen, /focusRequestCountRef\.current >= MOVIES_MAX_FOCUS_REQUESTS/);
});

test('11. No more than two viewport restores occur', () => {
  assert.equal(MOVIES_MAX_VIEWPORT_RESTORES, 2);
  assert.match(screen, /viewportRestoreCountRef/);
  // Stage 4.2F: caps via resolveMoviesDetailReturnMaxViewportRestores (2 fallback / 1 fast).
  assert.match(screen, /resolveMoviesDetailReturnMaxViewportRestores|MOVIES_MAX_VIEWPORT_RESTORES/);
  assert.match(screen, /viewportRestoreCountRef\.current < maxRestores/);
});

test('12. Stage 3D remains the only coordinator', () => {
  assert.doesNotMatch(screen, /MoviesFocusOwner|deriveMoviesFocusOwner/);
  assert.match(screen, /moviesDetailFocusLifecycle/);
  assert.match(screen, /stage3d1-movies-viewport-lock-v2/);
  assert.equal(isMoviesDetailClosingPhase('closing-viewport'), true);
  assert.equal(isMoviesDetailClosingPhase('closing-scroll'), false);
  assert.match(lifecycle, /\[NovaCast Movies Viewport Lock\]/);
  assert.match(lifecycle, /\[NovaCast Movies Preferred Focus Suppression\]/);
});

test('13. No catalog\/SQL\/category files change in Stage 3D.1 surface', () => {
  assert.doesNotMatch(lifecycle, /getCatalogCategoryCounts|catalog_items_v2/);
  assert.doesNotMatch(screen, /getCatalogCategoryCounts|writeCatalogItemsBatch/);
  assert.match(repository, /getCatalogCategoryCounts/);
  assert.match(sqlite, /createSqliteMovieDataSource/);
});

test('suppression releases after overlay removal and delay', () => {
  assert.equal(MOVIES_FOCUS_SUPPRESSION_RELEASE_MS, 32);
  assert.match(screen, /releaseFocusSuppressionAfterStabilize/);
  assert.match(screen, /logMoviesFocusSuppression/);
});
