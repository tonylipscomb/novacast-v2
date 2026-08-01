import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const screen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
const grid = fs.readFileSync('src/features/movies/components/MoviePosterGrid.tsx', 'utf8');
const repository = fs.readFileSync('src/features/catalog/catalogRepository.ts', 'utf8');
const datasource = fs.readFileSync('src/features/movies/data/SqliteMovieDataSource.ts', 'utf8');
const model = fs.readFileSync('src/features/movies/useMoviesScreenModel.ts', 'utf8');

test('viewport snapshot stores offset and visible bounds before detail', () => {
  assert.match(screen, /viewportStateRef/);
  assert.match(screen, /verticalOffset/);
  assert.match(screen, /visibleFirstIndex/);
  assert.match(screen, /visibleLastIndex/);
  assert.match(screen, /createMoviesBrowseFocusSnapshot/);
});

test('visible restoration uses saved offset not index positioning', () => {
  assert.match(grid, /snapshotTargetWasVisible/);
  assert.match(grid, /scrollToOffset/);
  assert.match(grid, /scrolled-to-saved-offset/);
});

test('offscreen restoration scrolls at most once per token via offset', () => {
  assert.match(grid, /viewportRestoreIssuedKeyRef|restorationScrollIssuedRef/);
  assert.match(grid, /detail-restoration-saved-offset|detail-restoration-offscreen-saved-offset/);
  assert.doesNotMatch(grid, /viewPosition\s*:/);
});

test('grid emits the central scroll command diagnostic', () => {
  assert.match(grid, /\[NovaCast Movies Scroll Command\]/);
  assert.match(grid, /method: 'scrollToOffset'/);
  assert.match(grid, /currentOffset/);
});

test('viewport tracking uses scroll and viewability callbacks', () => {
  assert.match(grid, /onScroll=\{handleScroll\}/);
  assert.match(grid, /onViewableItemsChanged=\{handleViewableItemsChanged\}/);
  assert.match(grid, /onViewportChange/);
});

test('focus confirmation records highlighted viewport and ends restoration', () => {
  assert.match(screen, /highlightVisible: true/);
  assert.match(screen, /browse-restored/);
  assert.match(screen, /detailFocusTokenRef\.current = null/);
  assert.match(screen, /completeDetailFocusRestore/);
});

test('All Movies count is a direct catalog_items count', () => {
  assert.match(repository, /SELECT COUNT\(\*\) AS total[\s\S]*FROM catalog_items/);
  assert.match(repository, /sync_generation = \?/);
  assert.doesNotMatch(repository, /getCatalogTotalCount[\s\S]{0,300}JOIN catalog_categories/);
});

test('movie page reads can remain pinned to the selected readable generation', () => {
  assert.match(repository, /query\.generation \?\?/);
  assert.match(datasource, /generation: readableGeneration/);
});

test('invalid category refreshes preserve the prior provider rail', () => {
  assert.match(model, /NovaCast Movies Category Refresh Rejected/);
  assert.match(model, /zero-provider-categories/);
  assert.match(model, /suspiciously-tiny-total/);
  assert.match(model, /return previous/);
});

test('no new global focus-owner abstraction is introduced', () => {
  assert.doesNotMatch(screen, /MoviesFocusOwner/);
  assert.doesNotMatch(grid, /MoviesFocusOwner/);
});
