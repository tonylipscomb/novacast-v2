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
} from '../src/features/movies/moviesDetailFocusLifecycle.ts';

const screen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
const grid = fs.readFileSync('src/features/movies/components/MoviePosterGrid.tsx', 'utf8');
const lifecycle = fs.readFileSync('src/features/movies/moviesDetailFocusLifecycle.ts', 'utf8');
const toolbar = fs.readFileSync('src/features/movies/components/MovieToolbar.tsx', 'utf8');
const repository = fs.readFileSync('src/features/catalog/catalogRepository.ts', 'utf8');
const sqlite = fs.readFileSync('src/features/movies/data/SqliteMovieDataSource.ts', 'utf8');

test('saved visible range is used while overlay is open', () => {
  const snapshot = createMoviesBrowseFocusSnapshot({
    categoryId: 'c1',
    movieId: 'm100',
    movieIndex: 100,
    verticalOffset: 4319.5,
    visibleFirstIndex: 90,
    visibleLastIndex: 110,
  });
  assert.equal(wasMoviesSnapshotTargetVisible(snapshot), true);
  assert.match(lifecycle, /wasMoviesSnapshotTargetVisible/);
  assert.match(screen, /snapshotTargetWasVisible/);
  assert.match(screen, /wasMoviesSnapshotTargetVisible\(snapshot\)/);
});

test('stale live targetVisible=false does not force index positioning', () => {
  assert.match(grid, /snapshotTargetWasVisible/);
  assert.match(grid, /scrollToOffset/);
  assert.doesNotMatch(grid, /viewPosition\s*:/);
  assert.doesNotMatch(grid, /scrollToIndex\(\{ index: restoreMovieIndex/);
  assert.match(screen, /snapshotWasVisible/);
});

test('viewport restores before poster focus', () => {
  assert.match(lifecycle, /closing-viewport/);
  assert.match(screen, /closing-viewport/);
  assert.match(screen, /setDetailFocusPhaseSafe\('closing-viewport'\)/);
  assert.match(screen, /setDetailFocusPhaseSafe\('closing-focus'\)/);
  assert.match(screen, /Never transfer poster focus until the saved offset is stable/);
  assert.match(grid, /reason: 'initial'/);
  assert.match(grid, /scrollToOffset\(\{ offset, animated: false \}\)/);
});

test('native offset drift after focus triggers one correction', () => {
  assert.equal(MOVIES_MAX_VIEWPORT_RESTORES, 2);
  assert.equal(MOVIES_MAX_FOCUS_REQUESTS, 2);
  assert.equal(MOVIES_VIEWPORT_OFFSET_TOLERANCE_PX, 12);
  assert.match(screen, /reason: 'corrective'/);
  assert.match(grid, /detail-restoration-corrective-offset/);
  assert.match(lifecycle, /logMoviesViewportLock/);
});

test('restoration does not complete until focus and offset both confirm', () => {
  assert.match(lifecycle, /isMoviesDetailFocusConfirmed/);
  assert.match(lifecycle, /isMoviesViewportOffsetStable/);
  assert.match(screen, /Do not complete on focus alone/);
  assert.equal(
    isMoviesViewportOffsetStable({ currentOffset: 4319.5, snapshotOffset: 4319.5 }),
    true,
  );
  assert.equal(
    isMoviesViewportOffsetStable({ currentOffset: 3951, snapshotOffset: 4319.5 }),
    false,
  );
});

test('no target alignment to top row', () => {
  assert.doesNotMatch(grid, /viewPosition\s*:/);
  assert.doesNotMatch(grid, /scrollToIndex/);
  assert.match(grid, /method: 'scrollToOffset'/);
  assert.match(grid, /Never top-row-align/);
});

test('Search cannot claim preferred focus during stabilization', () => {
  for (const phase of ['closing-prepare', 'closing-viewport', 'closing-focus', 'closing-confirm', 'browse-restored']) {
    assert.equal(shouldSuppressMoviesSearchFocus(phase), true);
  }
  assert.equal(shouldSuppressMoviesSearchFocus('browse'), false);
  assert.match(toolbar, /focusable\?: boolean/);
  assert.match(screen, /focusable=\{!searchFocusSuppressed\}/);
});

test('navbar\/category cannot claim preferred focus during stabilization', () => {
  for (const phase of ['closing-prepare', 'closing-viewport', 'closing-focus', 'closing-confirm', 'browse-restored']) {
    assert.equal(isMoviesFocusSuppressionActive(phase), true);
  }
  assert.match(screen, /navigationFocusable=\{!focusSuppressionActive && !detailOpen\}/);
  assert.match(screen, /focusable=\{!focusSuppressionActive && !detailOpen\}/);
});

test('suppression releases after overlay removal and delay', () => {
  assert.equal(MOVIES_FOCUS_SUPPRESSION_RELEASE_MS, 150);
  assert.match(screen, /releaseFocusSuppressionAfterStabilize/);
  assert.match(screen, /MOVIES_FOCUS_SUPPRESSION_RELEASE_MS/);
  assert.match(screen, /logMoviesFocusSuppression/);
  assert.match(lifecycle, /\[NovaCast Movies Focus Suppression\]/);
});

test('no more than two viewport corrections or two focus requests', () => {
  assert.match(screen, /MOVIES_MAX_VIEWPORT_RESTORES/);
  assert.match(screen, /MOVIES_MAX_FOCUS_REQUESTS/);
  assert.match(screen, /viewportRestoreCountRef/);
  assert.match(screen, /focusRequestCountRef/);
});

test('Stage 3D lifecycle remains the only coordinator', () => {
  assert.doesNotMatch(screen, /MoviesFocusOwner|deriveMoviesFocusOwner/);
  assert.match(screen, /moviesDetailFocusLifecycle/);
  assert.match(screen, /stage3d1-movies-viewport-first-handoff-v1/);
  assert.equal(isMoviesDetailClosingPhase('closing-viewport'), true);
  assert.equal(isMoviesDetailClosingPhase('closing-scroll'), false);
});

test('no catalog\/SQL\/category files change in Stage 3D.1 surface', () => {
  assert.doesNotMatch(lifecycle, /getCatalogCategoryCounts|catalog_items_v2/);
  assert.doesNotMatch(screen, /getCatalogCategoryCounts|writeCatalogItemsBatch/);
  assert.match(repository, /getCatalogCategoryCounts/);
  assert.match(sqlite, /createSqliteMovieDataSource/);
});
