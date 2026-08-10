import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  deriveMoviesPaginationLoaderMode,
  deriveMoviesPrimaryLoaderMode,
  MOVIES_PAGINATION_LOADER_LABEL,
  resolveMoviesPrimaryLoaderLabel,
} from '../src/features/movies/moviesLoaderState.ts';

const screen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
const grid = fs.readFileSync('src/features/movies/components/MoviePosterGrid.tsx', 'utf8');
const loader = fs.readFileSync('src/components/nova/NovaSpaceLoader.tsx', 'utf8');
const loaderState = fs.readFileSync('src/features/movies/moviesLoaderState.ts', 'utf8');
const lifecycle = fs.readFileSync('src/features/movies/moviesDetailFocusLifecycle.ts', 'utf8');
const repository = fs.readFileSync('src/features/catalog/catalogRepository.ts', 'utf8');
const model = fs.readFileSync('src/features/movies/useMoviesScreenModel.ts', 'utf8');

test('1. Initial Movies load shows large spaceship and Loading Movies', () => {
  assert.equal(
    deriveMoviesPrimaryLoaderMode({
      hasCategories: false,
      hasUsableItems: false,
      categoryFirstPageLoading: false,
      categoriesLoading: true,
    }),
    'initial',
  );
  assert.equal(
    resolveMoviesPrimaryLoaderLabel({
      primaryMode: 'initial',
      categoryDisplayName: null,
      hasCategories: false,
    }),
    'Loading Movies',
  );
  assert.match(screen, /variant="hero"/);
  assert.match(screen, /primaryLoaderLabel/);
});

test('2. All Movies first load shows Loading All Movies', () => {
  assert.equal(
    resolveMoviesPrimaryLoaderLabel({
      primaryMode: 'initial',
      categoryDisplayName: 'All Movies',
      hasCategories: true,
    }),
    'Loading All Movies',
  );
});

test('3. Provider category load uses category display name', () => {
  assert.equal(
    resolveMoviesPrimaryLoaderLabel({
      primaryMode: 'category-blocking',
      categoryDisplayName: 'Boxing',
      hasCategories: true,
    }),
    'Loading Boxing',
  );
  assert.equal(
    resolveMoviesPrimaryLoaderLabel({
      primaryMode: 'category-blocking',
      categoryDisplayName: 'Netflix',
      hasCategories: true,
    }),
    'Loading Netflix',
  );
  assert.doesNotMatch(loaderState, /categoryId.*Loading/);
});

test('4. Smart category load uses smart-category title', () => {
  assert.equal(
    resolveMoviesPrimaryLoaderLabel({
      primaryMode: 'category-blocking',
      categoryDisplayName: 'New Releases',
      hasCategories: true,
    }),
    'Loading New Releases',
  );
  assert.match(screen, /selectedCategoryLabel/);
  assert.match(screen, /displayProviderCategoryName/);
});

test('5. Primary loader is centered within poster-grid area', () => {
  assert.match(screen, /primaryLoaderOverlay/);
  assert.match(screen, /listOverlays/);
  assert.match(screen, /top:\s*'42%'/);
  assert.match(screen, /middleColumn/);
});

test('6. Primary wrapper is transparent', () => {
  assert.match(screen, /primaryLoaderOverlay:[\s\S]*backgroundColor: 'transparent'/);
  assert.match(screen, /primaryLoaderContent:[\s\S]*backgroundColor: 'transparent'/);
  assert.match(loader, /hero:[\s\S]*backgroundColor: 'transparent'/);
});

test('7. Pagination shows one compact bottom loader', () => {
  assert.equal(
    deriveMoviesPaginationLoaderMode({
      primaryVisible: false,
      paginationLoading: true,
      hasUsableItems: true,
    }),
    'loading-more',
  );
  assert.match(screen, /paginationLoaderBar/);
  assert.match(screen, /variant="inline"/);
  assert.match(screen, /paginationLoaderPill|bottom: 18/);
});

test('8. Pagination label says Loading more movies…', () => {
  assert.equal(MOVIES_PAGINATION_LOADER_LABEL, 'Loading more movies…');
  assert.match(screen, /MOVIES_PAGINATION_LOADER_LABEL/);
});

test('9. Primary and pagination loaders never show together', () => {
  assert.equal(
    deriveMoviesPaginationLoaderMode({
      primaryVisible: true,
      paginationLoading: true,
      hasUsableItems: true,
    }),
    'hidden',
  );
  assert.match(loaderState, /Never show both|mutually exclusive/i);
});

test('10. Pagination loader is not focusable', () => {
  assert.match(screen, /paginationLoaderBar[\s\S]{0,200}focusable=\{false\}/);
  assert.match(screen, /paginationLoaderBar[\s\S]{0,200}pointerEvents="none"/);
  assert.match(screen, /paginationLoaderBar[\s\S]{0,200}accessible=\{false\}/);
});

test('11. Neither loader changes focus state', () => {
  assert.match(screen, /primaryLoaderOverlay[\s\S]{0,160}pointerEvents="none"/);
  assert.match(screen, /primaryLoaderOverlay[\s\S]{0,160}focusable=\{false\}/);
  assert.doesNotMatch(screen, /NovaSpaceLoader[\s\S]{0,80}hasTVPreferredFocus/);
  assert.doesNotMatch(loaderState, /requestTvFocus|hasTVPreferredFocus|detailFocusPhase/);
});

test('12. Detail open\/close does not trigger either loader', () => {
  assert.doesNotMatch(loaderState, /detailOpen|postRestore|closing-focus/);
  const deriveBlock = screen.slice(
    screen.indexOf('deriveMoviesPrimaryLoaderMode({'),
    screen.indexOf('deriveMoviesPrimaryLoaderMode({') + 320,
  );
  assert.doesNotMatch(deriveBlock, /detailOpen|detailFocusPhase|postRestore/);
});

test('13. No catalog, SQL, focus, Series, Live TV, Search, or playback behavior changes', () => {
  assert.match(lifecycle, /MOVIES_POST_RESTORE_LATCH_MS|closing-viewport/);
  assert.match(screen, /activatePostRestoreLatch|completeDetailFocusRestore/);
  assert.match(repository, /getCatalogCategoryCounts/);
  assert.match(model, /getListOffset/);
  assert.doesNotMatch(grid, /NovaSpaceLoader/);
});

test('diagnostics log primary and pagination on mode change only', () => {
  assert.match(screen, /primaryDiagRef\.current === diagKey/);
  assert.match(screen, /paginationDiagRef\.current === diagKey/);
  assert.match(loaderState, /\[NovaCast Movies Primary Loader\]/);
  assert.match(loaderState, /\[NovaCast Movies Pagination Loader\]/);
  assert.match(loaderState, /stage3e3-movies-loader-layout-v1/);
});
