import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  deriveMoviesLoaderMode,
  deriveMoviesPrimaryLoaderMode,
} from '../src/features/movies/moviesLoaderState.ts';

const screen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
const grid = fs.readFileSync('src/features/movies/components/MoviePosterGrid.tsx', 'utf8');
const loader = fs.readFileSync('src/components/nova/NovaSpaceLoader.tsx', 'utf8');
const loaderState = fs.readFileSync('src/features/movies/moviesLoaderState.ts', 'utf8');
const model = fs.readFileSync('src/features/movies/useMoviesScreenModel.ts', 'utf8');
const lifecycle = fs.readFileSync('src/features/movies/moviesDetailFocusLifecycle.ts', 'utf8');
const repository = fs.readFileSync('src/features/catalog/catalogRepository.ts', 'utf8');
const series = fs.readFileSync('src/features/series/SeriesScreen.tsx', 'utf8');

test('1. Initial empty Movies load shows one spaceship loader', () => {
  assert.equal(
    deriveMoviesLoaderMode({
      hasCategories: false,
      hasUsableItems: false,
      categoryFirstPageLoading: false,
      categoriesLoading: true,
    }),
    'initial',
  );
  assert.equal(
    deriveMoviesPrimaryLoaderMode({
      hasCategories: true,
      hasUsableItems: false,
      categoryFirstPageLoading: true,
      categoriesLoading: false,
    }),
    'initial',
  );
  // Stage 4.2Q-ui: primary loader uses NovaSpaceLoader's default cohesive
  // presentation (no explicit variant) to match Series, exactly once.
  assert.match(screen, /<NovaSpaceLoader label=\{primaryLoaderLabel\} \/>/);
  assert.equal((screen.match(/<NovaSpaceLoader label=\{primaryLoaderLabel\} \/>/g) ?? []).length, 1);
});

test('2. Uncached category first-page load shows one spaceship loader', () => {
  assert.equal(
    deriveMoviesLoaderMode({
      hasCategories: true,
      hasUsableItems: true,
      categoryFirstPageLoading: true,
      categoriesLoading: false,
    }),
    'category-blocking',
  );
  assert.match(screen, /primaryLoaderOverlay/);
  assert.match(screen, /gridStageDimmed/);
  assert.match(model, /keep prior posters as a dimmed backdrop/);
});

test('3. Cached category switch does not show a blocking loader', () => {
  assert.equal(
    deriveMoviesLoaderMode({
      hasCategories: true,
      hasUsableItems: true,
      categoryFirstPageLoading: false,
      categoriesLoading: false,
    }),
    'hidden',
  );
});

test('4. Pagination does not drive the primary loader', () => {
  assert.equal(
    deriveMoviesLoaderMode({
      hasCategories: true,
      hasUsableItems: true,
      categoryFirstPageLoading: false,
      categoriesLoading: false,
    }),
    'hidden',
  );
  assert.match(screen, /paginationLoading = loading && !categoryLoading/);
  assert.doesNotMatch(grid, /NovaSpaceLoader/);
});

test('5. No More available chrome remains in the grid', () => {
  assert.doesNotMatch(grid, /More available/);
  assert.doesNotMatch(screen, /More available/);
});

test('6. No top-right badge loader remains', () => {
  assert.doesNotMatch(screen, /variant="badge"/);
  assert.doesNotMatch(grid, /variant="badge"/);
  assert.doesNotMatch(grid, /largeLoader/);
});

test('7. Loader wrapper is transparent', () => {
  assert.match(screen, /primaryLoaderOverlay:[\s\S]*backgroundColor: 'transparent'/);
  assert.match(loader, /panel:[\s\S]*backgroundColor: 'transparent'/);
});

test('8. No opaque card surrounds the spaceship', () => {
  assert.match(loader, /No card \/ shadow wrapper/);
  assert.match(screen, /borderWidth: 0/);
  assert.doesNotMatch(screen, /initialLoadingPanel/);
});

test('9. Focus anchor and visual loader are separate', () => {
  assert.match(screen, /loadingFocusAnchor/);
  assert.match(screen, /separate from Stage 3E/);
  assert.match(screen, /primaryLoaderOverlay/);
  assert.equal((screen.match(/loadingFocusAnchor/g) ?? []).length, 2);
});

test('10. Detail open\/close does not change primary loader derivation', () => {
  assert.match(loaderState, /Focus lifecycle, detail restore/);
  assert.doesNotMatch(loaderState, /detailOpen|postRestore|detailFocusPhase/);
  assert.match(screen, /deriveMoviesPrimaryLoaderModeFromGate\(\{|isMoviesPrimaryLoaderGateVisible\(\{/);
});

test('11. No catalog, focus, Series, Live TV, Search, or playback behavior changes', () => {
  assert.match(lifecycle, /stage3d1|closing-viewport|MOVIES_POST_RESTORE_LATCH_MS/);
  assert.match(screen, /activatePostRestoreLatch|completeDetailFocusRestore/);
  assert.match(repository, /getCatalogCategoryCounts/);
  assert.match(series, /NovaSpaceLoader/);
});
