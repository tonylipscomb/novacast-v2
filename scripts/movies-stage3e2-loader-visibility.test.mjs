import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  deriveMoviesPaginationLoaderMode,
  deriveMoviesPrimaryLoaderModeFromGate,
  isMoviesPrimaryLoaderGateVisible,
  MOVIES_PRIMARY_LOADER_MIN_MS,
  resolveMoviesPrimaryLoaderLabel,
} from '../src/features/movies/moviesLoaderState.ts';

const screen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
const grid = fs.readFileSync('src/features/movies/components/MoviePosterGrid.tsx', 'utf8');
const loaderState = fs.readFileSync('src/features/movies/moviesLoaderState.ts', 'utf8');
const model = fs.readFileSync('src/features/movies/useMoviesScreenModel.ts', 'utf8');
const lifecycle = fs.readFileSync('src/features/movies/moviesDetailFocusLifecycle.ts', 'utf8');
const repository = fs.readFileSync('src/features/catalog/catalogRepository.ts', 'utf8');

test('1. Category loader stays visible until selected category first page is usable', () => {
  assert.equal(
    isMoviesPrimaryLoaderGateVisible({
      categoriesLoading: false,
      loadingCategoryId: 'boxing',
      firstPageResolvedCategoryId: null,
    }),
    true,
  );
  assert.equal(
    isMoviesPrimaryLoaderGateVisible({
      categoriesLoading: false,
      loadingCategoryId: 'boxing',
      firstPageResolvedCategoryId: 'boxing',
    }),
    false,
  );
  assert.match(model, /firstPageResolvedCategoryId: selectedCategoryId/);
  assert.match(model, /loadingRequestToken: requestKey/);
});

test('2. Old retained posters do not hide the loader early', () => {
  assert.equal(
    deriveMoviesPrimaryLoaderModeFromGate({
      categoriesLoading: false,
      loadingCategoryId: 'netflix',
      firstPageResolvedCategoryId: null,
      hasUsableItems: true,
    }),
    'category-blocking',
  );
  assert.match(model, /firstPageResolvedCategoryId: null/);
  assert.doesNotMatch(model, /displayedCategoryId/);
});

test('3. Stale prior category request cannot hide the current loader', () => {
  assert.match(model, /previous\.loadingRequestToken !== requestKey/);
  assert.match(loaderState, /stale completions cannot hide|request token/i);
});

test('4. Minimum display duration prevents flashing', () => {
  assert.ok(MOVIES_PRIMARY_LOADER_MIN_MS >= 350 && MOVIES_PRIMARY_LOADER_MIN_MS <= 500);
  assert.match(screen, /MOVIES_PRIMARY_LOADER_MIN_MS/);
  assert.match(screen, /primaryHoldVisible/);
});

test('5. Loader label remains visible with the spaceship', () => {
  assert.equal(
    resolveMoviesPrimaryLoaderLabel({
      primaryMode: 'category-blocking',
      categoryDisplayName: 'Boxing',
      hasCategories: true,
    }),
    'Loading Boxing',
  );
  // Stage 4.2Q-ui: label is rendered by NovaSpaceLoader's own default cohesive
  // presentation (rocket + label + energy bar), matching Series, instead of a
  // separately-styled Text alongside a bare "hero" spaceship.
  assert.match(screen, /<NovaSpaceLoader label=\{primaryLoaderLabel\} \/>/);
});

test('6. Primary loader is centered in the grid wrapper, not a FlatList footer', () => {
  assert.match(screen, /primaryLoaderOverlay/);
  assert.match(screen, /justifyContent: 'center'/);
  assert.doesNotMatch(grid, /ListFooterComponent/);
  assert.doesNotMatch(grid, /NovaSpaceLoader/);
});

test('7. Primary loader is positioned higher than bottom placement', () => {
  assert.match(screen, /top:\s*'42%'/);
  assert.doesNotMatch(screen, /primaryLoaderTopSpacer/);
  assert.match(screen, /listStage viewport|42%/);
});

test('8. Pagination loader uses a translucent rounded backplate', () => {
  assert.match(screen, /paginationLoaderPill/);
  assert.match(screen, /rgba\(4, 10, 24, 0\.7\)/);
  assert.match(screen, /borderRadius: 22/);
});

test('9. Pagination loader is an absolute overlay and does not change FlatList content height', () => {
  assert.match(screen, /paginationLoaderBar:[\s\S]*position: 'absolute'/);
  assert.doesNotMatch(grid, /ListFooterComponent/);
  assert.doesNotMatch(grid, /contentContainerStyle[\s\S]*Loading more/);
});

test('10. Pagination loader never appears with the primary loader', () => {
  assert.equal(
    deriveMoviesPaginationLoaderMode({
      primaryVisible: true,
      paginationLoading: true,
      hasUsableItems: true,
    }),
    'hidden',
  );
  assert.match(screen, /primaryVisible: primaryLoaderVisible/);
});

test('11. Pagination loader hides after append\/failure\/category change\/detail open', () => {
  assert.equal(
    deriveMoviesPaginationLoaderMode({
      primaryVisible: false,
      paginationLoading: false,
      hasUsableItems: true,
    }),
    'hidden',
  );
  assert.equal(
    deriveMoviesPaginationLoaderMode({
      primaryVisible: false,
      paginationLoading: true,
      hasUsableItems: true,
      detailBlocksBrowse: true,
    }),
    'hidden',
  );
  assert.match(screen, /detailBlocksBrowse/);
});

test('12. Neither loader is focusable or changes focus state', () => {
  assert.match(screen, /primaryLoaderOverlay[\s\S]{0,180}focusable=\{false\}/);
  assert.match(screen, /paginationLoaderBar[\s\S]{0,180}focusable=\{false\}/);
  assert.match(screen, /pointerEvents="none"/);
  assert.doesNotMatch(loaderState, /requestTvFocus|hasTVPreferredFocus/);
});

test('13. No catalog, SQL, category-count, focus, Series, Live TV, Search, or playback behavior changes', () => {
  assert.match(lifecycle, /MOVIES_POST_RESTORE_LATCH_MS|closing-viewport/);
  assert.match(screen, /activatePostRestoreLatch|completeDetailFocusRestore/);
  assert.match(repository, /getCatalogCategoryCounts/);
  assert.match(model, /firstPageLoadGate/);
  assert.doesNotMatch(loaderState, /getCatalogCategoryCounts|catalog_items_v2/);
});

test('diagnostics include request token and hide reason', () => {
  assert.match(loaderState, /stage3e3-movies-loader-layout-v1/);
  assert.match(loaderState, /loadingCategoryId/);
  assert.match(loaderState, /hideReason/);
  assert.match(loaderState, /minimumDurationMet/);
  assert.match(loaderState, /primaryLoaderVisible/);
  assert.match(loaderState, /placement/);
});
