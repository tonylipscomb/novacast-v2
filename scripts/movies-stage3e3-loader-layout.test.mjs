import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  deriveMoviesPaginationLoaderMode,
  deriveMoviesPrimaryLoaderModeFromGate,
  isMoviesPrimaryLoaderGateVisible,
  resolveMoviesPrimaryLoaderLabel,
  sanitizeMoviesCategoryDisplayName,
} from '../src/features/movies/moviesLoaderState.ts';

const screen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
const grid = fs.readFileSync('src/features/movies/components/MoviePosterGrid.tsx', 'utf8');
const loaderState = fs.readFileSync('src/features/movies/moviesLoaderState.ts', 'utf8');
const model = fs.readFileSync('src/features/movies/useMoviesScreenModel.ts', 'utf8');
const smartSource = fs.readFileSync('src/features/movies/smart/SmartMovieDataSource.ts', 'utf8');
const spaceLoader = fs.readFileSync('src/components/nova/NovaSpaceLoader.tsx', 'utf8');
const repository = fs.readFileSync('src/features/catalog/catalogRepository.ts', 'utf8');
const lifecycle = fs.readFileSync('src/features/movies/moviesDetailFocusLifecycle.ts', 'utf8');

test('1. Primary loader renders inside MoviePosterGrid list viewport', () => {
  assert.match(grid, /listOverlays/);
  assert.match(grid, /\{listOverlays\}/);
  assert.match(screen, /listOverlays=\{/);
  assert.match(screen, /primaryLoaderOverlay/);
  assert.doesNotMatch(grid, /ListFooterComponent/);
});

test('2. Primary loader is positioned near 42% of the poster list height', () => {
  assert.match(screen, /top:\s*'42%'/);
  assert.match(screen, /gap:\s*24/);
  assert.doesNotMatch(screen, /primaryLoaderTopSpacer/);
  assert.doesNotMatch(screen, /translateY:\s*-28/);
});

test('3. Exactly one glow remains on the spaceship', () => {
  assert.doesNotMatch(screen, /primaryLoaderGlow/);
  assert.match(spaceLoader, /heroGlow/);
  assert.equal((spaceLoader.match(/heroGlow/g) || []).length >= 1, true);
});

test('4. Loader gate does not mutate displayed category / movies', () => {
  assert.doesNotMatch(model, /displayedCategoryId/);
  assert.doesNotMatch(loaderState, /displayedCategoryId/);
  assert.match(model, /observe readiness only|never mutates displayed/i);
  assert.match(loaderState, /never mutates displayed/i);
});

test('5. Retained posters keep category-blocking mode until first page ready', () => {
  assert.equal(
    isMoviesPrimaryLoaderGateVisible({
      categoriesLoading: false,
      loadingCategoryId: 'netflix',
      firstPageResolvedCategoryId: null,
    }),
    true,
  );
  assert.equal(
    deriveMoviesPrimaryLoaderModeFromGate({
      categoriesLoading: false,
      loadingCategoryId: 'netflix',
      firstPageResolvedCategoryId: null,
      hasUsableItems: true,
    }),
    'category-blocking',
  );
});

test('6. Loader label strips emoji / mojibake prefixes', () => {
  assert.equal(sanitizeMoviesCategoryDisplayName('⭐ Features'), 'Features');
  assert.equal(sanitizeMoviesCategoryDisplayName('Γ¡É Features'), 'Features');
  assert.equal(
    resolveMoviesPrimaryLoaderLabel({
      primaryMode: 'category-blocking',
      categoryDisplayName: '⭐ Features',
      hasCategories: true,
    }),
    'Loading Features',
  );
  assert.match(smartSource, /name:\s*definition\.name/);
  assert.doesNotMatch(smartSource, /name:\s*`\$\{definition\.icon\}/);
});

test('7. Pagination pill keeps absolute overlay with blur + ~70% opacity', () => {
  assert.match(screen, /BlurView/);
  assert.match(screen, /rgba\(4, 10, 24, 0\.7\)/);
  assert.match(screen, /intensity=\{10\}/);
  assert.match(spaceLoader, /fontSize:\s*15/);
  assert.match(screen, /paginationLoaderBar:[\s\S]*position: 'absolute'/);
});

test('8. Pagination never appears with primary loader', () => {
  assert.equal(
    deriveMoviesPaginationLoaderMode({
      primaryVisible: true,
      paginationLoading: true,
      hasUsableItems: true,
    }),
    'hidden',
  );
});

test('9. Neither loader is focusable', () => {
  assert.match(screen, /primaryLoaderOverlay[\s\S]{0,200}focusable=\{false\}/);
  assert.match(screen, /paginationLoaderBar[\s\S]{0,200}focusable=\{false\}/);
});

test('10. No catalog, SQL, focus, Series, Live TV, Search, or playback behavior changes', () => {
  assert.match(lifecycle, /MOVIES_POST_RESTORE_LATCH_MS|closing-viewport/);
  assert.match(repository, /getCatalogCategoryCounts/);
  assert.match(loaderState, /stage3e3-movies-loader-layout-v1/);
  assert.doesNotMatch(loaderState, /getCatalogCategoryCounts|catalog_items_v2/);
});
