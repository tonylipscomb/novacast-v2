import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';

import { normalizeTvRemoteImageUri } from '../src/components/media/tvRemoteImageUri.ts';
import {
  isLastPosterRow,
  resolvePosterFocusFallbackRegion,
  resolvePosterRestorationId,
  shouldAutoFocusSortControl,
  shouldClaimPreferredPosterFocus,
  shouldPreferNavigationFocus,
} from '../src/features/media-browser/posterGridFocusPolicy.ts';
import { shouldMoveFocusToChannelsOnCategoryOk } from '../src/features/live/liveTvFocusPreview.ts';
import {
  shouldReclaimSearchFromClose,
  shouldRefocusSearchShellOnTextInputBlur,
  shouldReturnFocusToSearchShellAfterIme,
  shouldWireCloseNextFocusToSearch,
  shouldWireSearchNextFocusUpToClose,
  resolveCloseNextFocusHandles,
  shouldAutoFocusSearchFocusGuide,
} from '../src/features/search/searchOverlayFocusPolicy.ts';

test('final poster row traps Down (no category/nav escape)', () => {
  assert.equal(isLastPosterRow({ index: 11, itemCount: 12, columns: 4 }), true);
  assert.equal(isLastPosterRow({ index: 8, itemCount: 12, columns: 4 }), true);
  assert.equal(isLastPosterRow({ index: 7, itemCount: 12, columns: 4 }), false);
  assert.equal(isLastPosterRow({ index: 0, itemCount: 3, columns: 4 }), true);
});

test('pagination loading does not gate preferred poster focus', () => {
  assert.equal(
    shouldClaimPreferredPosterFocus({ focusClaimed: false, itemId: 'a', seedId: 'a' }),
    true,
  );
  assert.equal(
    shouldClaimPreferredPosterFocus({ focusClaimed: true, itemId: 'a', seedId: 'a' }),
    false,
  );
  assert.equal(shouldAutoFocusSortControl({ sortOptionChanged: false, loadingChanged: true }), false);
});

test('detail/playback restoration prefers focused id and never navbar first', () => {
  assert.equal(
    resolvePosterRestorationId({
      focusedId: 'movie-9',
      selectedId: 'movie-1',
      availableIds: ['movie-1', 'movie-9'],
    }),
    'movie-9',
  );
  assert.equal(
    resolvePosterRestorationId({
      focusedId: 'gone',
      selectedId: 'movie-1',
      availableIds: ['movie-1', 'movie-2'],
    }),
    'movie-1',
  );
  assert.equal(
    resolvePosterRestorationId({
      focusedId: null,
      selectedId: null,
      availableIds: ['movie-3'],
    }),
    'movie-3',
  );
  assert.equal(resolvePosterFocusFallbackRegion({ gridEmpty: false }), 'poster-grid');
  assert.equal(resolvePosterFocusFallbackRegion({ gridEmpty: true }), 'categories');
});

test('exact restoration stays pending when the target is temporarily unavailable', () => {
  assert.equal(
    resolvePosterRestorationId({
      focusedId: 'movie-9',
      selectedId: 'movie-9',
      targetMovieId: 'movie-9',
      restorationActive: true,
      availableIds: ['movie-1', 'movie-2'],
    }),
    null,
  );
  assert.equal(
    resolvePosterRestorationId({
      focusedId: 'movie-9',
      selectedId: 'movie-9',
      targetMovieId: 'movie-9',
      targetConclusiveAbsent: true,
      restorationActive: true,
      availableIds: ['movie-1', 'movie-2'],
    }),
    'movie-1',
  );
});

test('navbar preferred focus is blocked while restoring browse focus', () => {
  assert.equal(
    shouldPreferNavigationFocus({
      playbackUiActive: false,
      detailOverlayVisible: false,
      searchBlocksBrowse: false,
      restoringBrowseFocus: true,
    }),
    false,
  );
  assert.equal(
    shouldPreferNavigationFocus({
      playbackUiActive: false,
      detailOverlayVisible: false,
      searchBlocksBrowse: false,
      restoringBrowseFocus: false,
      gridEmpty: false,
    }),
    false,
  );
  assert.equal(
    shouldPreferNavigationFocus({
      playbackUiActive: false,
      detailOverlayVisible: false,
      searchBlocksBrowse: false,
      restoringBrowseFocus: false,
      gridEmpty: true,
    }),
    true,
  );
});


test('Search Close does not bounce back to field', () => {
  assert.equal(shouldWireCloseNextFocusToSearch(), false);
  assert.equal(shouldWireSearchNextFocusUpToClose(), false);
  assert.equal(shouldReclaimSearchFromClose(true), false);
  assert.equal(shouldRefocusSearchShellOnTextInputBlur(), false);
  assert.equal(shouldReturnFocusToSearchShellAfterIme({ closeFocused: true }), false);
  assert.equal(shouldReturnFocusToSearchShellAfterIme({ closeFocused: false }), true);
  assert.equal(shouldAutoFocusSearchFocusGuide(), false);

  const handles = resolveCloseNextFocusHandles({ closeHandle: 10, searchFieldHandle: 20 });
  assert.deepEqual(handles, {
    nextFocusUp: 10,
    nextFocusLeft: 10,
    nextFocusRight: 10,
    nextFocusDown: 20,
  });
  assert.notEqual(handles?.nextFocusUp, 20);
});

test('image URI normalization is stable for poster and detail', () => {
  assert.equal(normalizeTvRemoteImageUri('  https://cdn.example/poster.jpg  '), 'https://cdn.example/poster.jpg');
  assert.equal(normalizeTvRemoteImageUri(''), null);
  assert.equal(normalizeTvRemoteImageUri(undefined), null);
});

test('Live TV category OK moves focus into channel list', () => {
  assert.equal(shouldMoveFocusToChannelsOnCategoryOk(), true);
});

test('focus visual tokens do not set text to blue/accent', async () => {
  const source = await fs.readFile(new URL('../src/components/nova/novaTvFocus.ts', import.meta.url), 'utf8');
  assert.match(source, /color:\s*theme\.colors\.textPrimary/);
  assert.match(source, /NOVA_TV_GLASS/);
  assert.doesNotMatch(source, /accentHover/);
  assert.doesNotMatch(source, /textShadowColor/);
  assert.doesNotMatch(source, /transform:\s*\[\s*\{\s*scale:/);
});

test('playback loading container uses transparent background (no rectangular dim)', async () => {
  const source = await fs.readFile(
    new URL('../src/features/playback/unified/UnifiedPlayerLoadingState.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /backgroundColor:\s*'transparent'/);
  assert.doesNotMatch(source, /rgba\(0,\s*0,\s*0,\s*0\.45\)/);
});

test('Series navigation cannot auto-wire Search preferred focus from poster grids', async () => {
  const moviesGrid = await fs.readFile(
    new URL('../src/features/movies/components/MoviePosterGrid.tsx', import.meta.url),
    'utf8',
  );
  const seriesGrid = await fs.readFile(
    new URL('../src/features/series/components/SeriesPosterGrid.tsx', import.meta.url),
    'utf8',
  );
  const toolbar = await fs.readFile(
    new URL('../src/features/movies/components/MovieToolbar.tsx', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(moviesGrid, /hasTVPreferredFocus=\{true\}/);
  assert.doesNotMatch(seriesGrid, /Search/);
  assert.doesNotMatch(toolbar, /hasTVPreferredFocus/);
});

test('Discover category counts apply cache/index on open and load progressively on focus', async () => {
  const {
    formatMovieCategoryCount,
    resolveSmartCategoryCountKnown,
    shouldPrefetchMovieCategoryCount,
    shouldNetworkFetchCategoryCountOnWarm,
    categoriesNeedingCountWarm,
    createSerialCategoryCountQueue,
  } = await import('../src/features/movies/movieCategoryCountPolicy.ts');

  assert.equal(formatMovieCategoryCount(12, false), '...');
  assert.equal(formatMovieCategoryCount(12, true), '12');
  assert.equal(formatMovieCategoryCount(0, true), '0');
  assert.equal(resolveSmartCategoryCountKnown({ cacheEntryExists: true, syncCount: 0 }), true);
  assert.equal(resolveSmartCategoryCountKnown({ cacheEntryExists: false, syncCount: 0 }), false);
  assert.equal(resolveSmartCategoryCountKnown({ cacheEntryExists: false, syncCount: 4 }), true);
  assert.equal(shouldPrefetchMovieCategoryCount({ categoryId: 'smart:features', kind: 'smart' }), true);
  assert.equal(shouldPrefetchMovieCategoryCount({ categoryId: 'section:discover', kind: 'section' }), false);
  assert.equal(shouldNetworkFetchCategoryCountOnWarm(), false);
  assert.equal(
    categoriesNeedingCountWarm([
      { id: 'smart:features', renderKey: 'smart:features', name: 'Discover', count: 0, countKnown: false, kind: 'smart' },
      { id: 'action', renderKey: 'action', name: 'Action', count: 9, countKnown: true, kind: 'provider' },
    ]).map((category) => category.id).join(','),
    'smart:features',
  );

  let generation = 1;
  const fetches = [];
  const resolved = [];
  const queue = createSerialCategoryCountQueue({
    concurrency: 1,
    getGeneration: () => generation,
    isAccepted: () => true,
    fetchCount: async (categoryId) => {
      fetches.push(categoryId);
      await Promise.resolve();
      return categoryId.length;
    },
    onCount: (categoryId, count) => {
      resolved.push(`${categoryId}:${count}`);
    },
  });
  assert.equal(queue.enqueue('a'), true);
  assert.equal(queue.enqueue('a'), false);
  assert.equal(queue.enqueue('b'), true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(fetches, ['a', 'b']);
  assert.deepEqual(resolved, ['a:1', 'b:1']);
  generation += 1;
  queue.reset();
  assert.equal(queue.enqueue('c'), true);

  const model = await fs.readFile(new URL('../src/features/movies/useMoviesScreenModel.ts', import.meta.url), 'utf8');
  const smartSource = await fs.readFile(
    new URL('../src/features/movies/smart/SmartMovieDataSource.ts', import.meta.url),
    'utf8',
  );
  const rail = await fs.readFile(
    new URL('../src/features/movies/components/MovieCategoryRail.tsx', import.meta.url),
    'utf8',
  );
  assert.match(model, /warmUnresolvedCategoryCounts/);
  assert.match(model, /category_counts_warm_index_only/);
  assert.match(model, /movies_page_gated_waiting_categories/);
  assert.match(model, /applyIndexedProviderCounts/);
  assert.doesNotMatch(model, /prefetchAllCategoryCounts\(smartIds/);
  assert.match(smartSource, /querySmartCategoryOnIndex\(index, definition, ctx, 0, 1\)/);
  assert.match(rail, /formatMovieCategoryCount/);
  assert.doesNotMatch(rail, /item\.kind !== 'smart'/);
});
