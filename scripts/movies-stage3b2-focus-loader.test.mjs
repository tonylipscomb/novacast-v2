import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const screen = await fs.readFile(new URL('../src/features/movies/MoviesScreen.tsx', import.meta.url), 'utf8');
const grid = await fs.readFile(new URL('../src/features/movies/components/MoviePosterGrid.tsx', import.meta.url), 'utf8');
const model = await fs.readFile(new URL('../src/features/movies/useMoviesScreenModel.ts', import.meta.url), 'utf8');
const sync = await fs.readFile(new URL('../src/features/providers/providerCatalogSync.ts', import.meta.url), 'utf8');
const shell = await fs.readFile(new URL('../src/components/nova/NovaTvShell.tsx', import.meta.url), 'utf8');
const category = await fs.readFile(new URL('../src/features/movies/components/MovieCategoryRail.tsx', import.meta.url), 'utf8');
const mediaDetail = await fs.readFile(new URL('../src/components/media/MediaDetailOverlay.tsx', import.meta.url), 'utf8');

test('Stage 3B.2 Movies focus handoff keeps a non-activating loading target', () => {
  assert.match(screen, /stage3b2-movies-focus-loader-polish-v1/);
  assert.match(screen, /loadingFocusAnchor/);
  assert.match(screen, /onPress=\{\(\) => undefined\}/);
  assert.match(screen, /restore-exact-poster-after-detail-close/);
  assert.match(screen, /NovaCast Movies Focus Handoff/);
  assert.match(screen, /logMoviesDetailFocusLifecycle/);
  assert.match(screen, /restoreMovieIndex/);
  assert.match(screen, /suppressPreferredFocus/);
  assert.equal((screen.match(/loadingFocusAnchor/g) ?? []).length, 2);
  assert.match(screen, /hasTVPreferredFocus=\{/);
  assert.match(screen, /!focusSuppressionActive/);
  assert.match(screen, /categoryFocusPendingRef\.current === selectedCategoryId/);
});

test('Stage 3B.2 uses one larger centered transparent loader', () => {
  assert.match(grid, /largeLoader/);
  assert.doesNotMatch(grid, /paginationLoader/);
  assert.doesNotMatch(grid, /variant="badge"/);
  assert.doesNotMatch(grid, /Loading more movies/);
  assert.doesNotMatch(grid, /backgroundColor:.*rgba/);
  assert.doesNotMatch(grid, /More available/);
});

test('exact restoration does not fall back to the first poster while pending', () => {
  assert.match(screen, /nearest-visible|timeout-nearest-visible-fallback/);
  assert.match(screen, /closingFocusMovieId/);
  assert.doesNotMatch(screen, /availableIds\[0\]/);
});

test('Stage 3B.2 focus and selection remain separate', () => {
  assert.match(screen, /focusMovie\(movie/);
  assert.match(screen, /selectMovie\(movie\)/);
  assert.match(model, /Focus restoration is browse chrome/);
});

test('Stage 3B.2 ready publication has one observable subscription identity', () => {
  assert.match(sync, /catalog_subscription_added/);
  assert.match(sync, /catalog_subscription_removed/);
  assert.match(model, /catalog_publication_ignored_duplicate/);
});

test('Stage 3B.2 poster refs use instance identity and focus confirmation', async () => {
  const card = await fs.readFile(new URL('../src/features/movies/components/MoviePosterCard.tsx', import.meta.url), 'utf8');
  assert.match(card, /instanceToken/);
  assert.match(card, /movie\.id/);
  assert.match(screen, /NovaCast Movie Poster Ref/);
  assert.match(screen, /completeDetailFocusRestore/);
  assert.match(screen, /status === 'timeout'/);
  assert.match(screen, /movie\.id !== targetId/);
});

test('Stage 3B.2 does not let category focus override an active restore token', () => {
  assert.match(screen, /isMoviesDetailClosingPhase\(detailFocusPhaseRef\.current\) \|\| detailFocusTokenRef\.current/);
  assert.match(grid, /suppressPreferredFocus/);
  assert.match(screen, /showMoviesVisualLoader/);
});

test('Stage 3B.4 rollback uses only narrow preferred-focus suppression', () => {
  assert.doesNotMatch(screen, /MoviesFocusOwner|deriveMoviesFocusOwner|focusOwner=/);
  assert.match(screen, /suppressNavbarPreferredFocus=\{navbarFocusSuppressed\}/);
  assert.match(screen, /suppressPreferredFocus=\{categoryFocusSuppressed\}/);
  assert.match(shell, /hasTVPreferredFocus=\{navbarPreferredFocus && active\}/);
  assert.match(category, /hasTVPreferredFocus=\{preferInitialFocus\}/);
  assert.doesNotMatch(shell, /MoviesFocusOwner|deriveMoviesFocusOwner/);
});

test('Stage 3D keeps exact confirmation before overlay removal', () => {
  assert.match(screen, /isMoviesDetailFocusConfirmed/);
  assert.match(screen, /setDetailOpen\(false\)/);
  assert.match(screen, /browse-restored/);
  assert.match(screen, /detailFocusTokenRef\.current = null/);
});

test('Stage 3B.4 preserves detail hook ordering', () => {
  const hookIndex = mediaDetail.indexOf('MediaDetailOverlay.TVFocusGuideView');
  assert.ok(hookIndex >= 0);
});
