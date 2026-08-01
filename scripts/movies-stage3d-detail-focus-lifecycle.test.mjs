import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  canBeginMoviesDetailClose,
  createMoviesBrowseFocusSnapshot,
  isMoviesBrowseSnapshotImmutable,
  isMoviesDetailClosingPhase,
  isMoviesDetailOverlayMounted,
  isMoviesSnapshotTargetVisible,
  resolveMoviesClosingFocusableMovieId,
  resolveNearestVisiblePoster,
  shouldSuppressMoviesCategoryFocus,
  shouldSuppressMoviesNavbarFocus,
} from '../src/features/movies/moviesDetailFocusLifecycle.ts';

const screen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
const grid = fs.readFileSync('src/features/movies/components/MoviePosterGrid.tsx', 'utf8');
const overlay = fs.readFileSync('src/components/media/MediaDetailOverlay.tsx', 'utf8');
const lifecycle = fs.readFileSync('src/features/movies/moviesDetailFocusLifecycle.ts', 'utf8');
const shell = fs.readFileSync('src/components/nova/NovaTvShell.tsx', 'utf8');
const category = fs.readFileSync('src/features/movies/components/MovieCategoryRail.tsx', 'utf8');
const repository = fs.readFileSync('src/features/catalog/catalogRepository.ts', 'utf8');
const sqlite = fs.readFileSync('src/features/movies/data/SqliteMovieDataSource.ts', 'utf8');
const counts = fs.readFileSync('src/features/movies/smart/SmartMovieDataSource.ts', 'utf8');

test('1. MoviePosterGrid remains mounted while detail is open', () => {
  assert.match(screen, /pointerEvents=\{/);
  assert.match(screen, /detailClosing/);
  assert.match(screen, /<MoviePosterGrid/);
  assert.match(screen, /<MediaDetailOverlay/);
  // Overlay is sibling, not a replacement of the grid branch.
  assert.doesNotMatch(screen, /detailOpen \? \s*<MediaDetailOverlay[\s\S]*: \s*<MoviePosterGrid/);
});

test('2. FlatList key does not change on detail open/close', () => {
  assert.match(grid, /key=\{columns\}/);
  assert.doesNotMatch(grid, /key=\{.*detail/);
  assert.doesNotMatch(grid, /key=\{.*selectedMovie/);
});

test('3. Browse snapshot is immutable while detail open/closing', () => {
  assert.match(lifecycle, /isMoviesBrowseSnapshotImmutable/);
  assert.equal(isMoviesBrowseSnapshotImmutable('detail-open'), true);
  assert.equal(isMoviesBrowseSnapshotImmutable('closing-focus'), true);
  assert.equal(isMoviesBrowseSnapshotImmutable('browse'), false);
  assert.match(screen, /isMoviesBrowseSnapshotImmutable\(phase\)/);
  const snap = createMoviesBrowseFocusSnapshot({
    categoryId: 'c1',
    movieId: 'm9',
    movieIndex: 42,
    verticalOffset: 1200,
    visibleFirstIndex: 36,
    visibleLastIndex: 48,
  });
  assert.equal(snap.movieId, 'm9');
  assert.equal(snap.movieIndex, 42);
});

test('4. Closing detail keeps overlay mounted until exact poster onFocus', () => {
  assert.equal(isMoviesDetailOverlayMounted('detail-open'), true);
  assert.equal(isMoviesDetailOverlayMounted('closing-prepare'), true);
  assert.equal(isMoviesDetailOverlayMounted('closing-confirm'), true);
  assert.equal(isMoviesDetailOverlayMounted('browse'), false);
  assert.match(screen, /completeDetailFocusRestore/);
  assert.match(screen, /setDetailOpen\(false\)/);
  assert.match(screen, /focusHandoffActive/);
  assert.match(overlay, /focusHandoffActive/);
  assert.match(overlay, /closeFocusTarget/);
});

test('5. Navbar cannot receive focus during closing states', () => {
  for (const phase of ['closing-prepare', 'closing-viewport', 'closing-focus', 'closing-confirm', 'browse-restored']) {
    assert.equal(shouldSuppressMoviesNavbarFocus(phase), true);
  }
  assert.equal(shouldSuppressMoviesNavbarFocus('browse'), false);
  assert.match(screen, /navigationFocusable=\{!focusSuppressionActive && !detailOpen\}/);
  assert.match(screen, /suppressNavbarPreferredFocus=\{navbarFocusSuppressed\}/);
});

test('6. Category rail cannot receive focus during closing states', () => {
  for (const phase of ['closing-prepare', 'closing-viewport', 'closing-focus', 'closing-confirm', 'browse-restored']) {
    assert.equal(shouldSuppressMoviesCategoryFocus(phase), true);
  }
  assert.match(screen, /focusable=\{!focusSuppressionActive && !detailOpen\}/);
  assert.match(category, /focusable=\{focusable\}/);
});

test('7. Non-target posters cannot claim preferred focus during closing', () => {
  assert.equal(
    resolveMoviesClosingFocusableMovieId({ phase: 'closing-focus', targetMovieId: 'm9' }),
    'm9',
  );
  assert.equal(resolveMoviesClosingFocusableMovieId({ phase: 'browse', targetMovieId: 'm9' }), null);
  assert.match(grid, /closingFocusMovieId/);
  assert.match(grid, /closingFocusMovieId != null \|\| suppressPreferredFocus/);
  assert.match(grid, /hasPreferredFocus=\{/);
});

test('8. Visible-at-open target restores saved offset (not index positioning)', () => {
  assert.equal(
    isMoviesSnapshotTargetVisible({ movieIndex: 40, visibleFirstIndex: 36, visibleLastIndex: 48 }),
    true,
  );
  assert.match(grid, /snapshotTargetWasVisible/);
  assert.match(grid, /scrollToOffset/);
  assert.match(screen, /closing-viewport/);
});

test('9. Offscreen target restores saved offset without top-row align', () => {
  assert.equal(
    isMoviesSnapshotTargetVisible({ movieIndex: 90, visibleFirstIndex: 36, visibleLastIndex: 48 }),
    false,
  );
  assert.match(grid, /scrollToOffset\(\{ offset, animated: false \}\)/);
  assert.match(grid, /scrolled-to-saved-offset|detail-restoration-offscreen-saved-offset/);
  assert.doesNotMatch(grid, /viewPosition\s*:/);
});

test('10. No scroll occurs after confirmation', () => {
  assert.match(grid, /restoreScrollBlocked/);
  assert.match(screen, /restoreScrollBlockedRef\.current = true/);
  assert.match(screen, /restoreScrollBlocked=\{/);
});

test('11. Item zero is never used as a temporary fallback', () => {
  assert.match(lifecycle, /nearest-visible/);
  assert.doesNotMatch(lifecycle, /availableIds\[0\]/);
  const nearest = resolveNearestVisiblePoster({
    targetIndex: 40,
    visibleFirstIndex: 30,
    visibleLastIndex: 35,
    movies: Array.from({ length: 50 }, (_, index) => ({ id: `m${index}` })),
  });
  assert.equal(nearest?.index, 35);
  assert.equal(nearest?.movieId, 'm35');
  assert.notEqual(nearest?.index, 0);
  // Index 0 only when it truly is nearest visible.
  const zero = resolveNearestVisiblePoster({
    targetIndex: 1,
    visibleFirstIndex: 0,
    visibleLastIndex: 2,
    movies: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  });
  assert.equal(zero?.index, 1);
});

test('12. Exact poster remains visibly highlighted after overlay removal', () => {
  assert.match(screen, /highlightVisible: true/);
  assert.match(screen, /phase: 'browse-restored'/);
  assert.match(screen, /overlayMounted: false/);
});

test('13. Second and third consecutive detail cycles work', () => {
  assert.equal(canBeginMoviesDetailClose('detail-open'), true);
  assert.equal(canBeginMoviesDetailClose('closing-prepare'), false);
  assert.equal(canBeginMoviesDetailClose('browse'), false);
  assert.match(screen, /canBeginMoviesDetailClose/);
  assert.match(screen, /setDetailFocusPhaseSafe\('detail-open'\)/);
  assert.match(screen, /setDetailFocusPhaseSafe\('browse'\)/);
});

test('14. Pagination does not break restoration', () => {
  assert.match(grid, /loadMore/);
  assert.match(screen, /restoreScrollBlocked/);
  assert.match(lifecycle, /closing-confirm/);
  // Close path does not reset visibleMovies / FlatList key.
  assert.doesNotMatch(screen, /setVisibleMovies\(\[\]\)/);
  assert.match(grid, /key=\{columns\}/);
});

test('15. No catalog\/SQLite\/category\/count files change in Stage 3D surface', () => {
  assert.doesNotMatch(lifecycle, /getCatalogCategoryCounts|catalog_items_v2|GROUP BY category_id/);
  assert.doesNotMatch(screen, /getCatalogCategoryCounts|writeCatalogItemsBatch/);
  // Source files still exist unchanged in role — Stage 3D must not own them.
  assert.match(repository, /getCatalogCategoryCounts/);
  assert.match(sqlite, /createSqliteMovieDataSource/);
  assert.match(counts, /resolveProviderCategoryCount/);
});

test('legacy close sentinel path is removed from MoviesScreen', () => {
  assert.doesNotMatch(screen, /detailCloseSentinelActive/);
  assert.doesNotMatch(screen, /detailCloseFocusSentinel/);
  assert.doesNotMatch(screen, /Close Sentinel/);
  assert.match(screen, /logMoviesDetailFocusLifecycle/);
  assert.match(lifecycle, /\[NovaCast Movies Detail Focus Lifecycle\]/);
  assert.match(screen, /stage3d-movies-detail-focus-lifecycle-v1/);
});

test('closing phases are recognized', () => {
  assert.equal(isMoviesDetailClosingPhase('closing-viewport'), true);
  assert.equal(isMoviesDetailClosingPhase('browse-restored'), false);
});

test('shell still exposes navbar suppression hooks used by Movies', () => {
  assert.match(shell, /suppressNavbarPreferredFocus/);
  assert.match(shell, /navigationFocusable/);
});
