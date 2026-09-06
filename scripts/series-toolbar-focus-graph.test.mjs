import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const toolbar = fs.readFileSync('src/features/movies/components/MovieToolbar.tsx', 'utf8');
const moviesScreen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
const seriesScreen = fs.readFileSync('src/features/series/SeriesScreen.tsx', 'utf8');
const seriesGrid = fs.readFileSync('src/features/series/components/SeriesPosterGrid.tsx', 'utf8');

test('MovieToolbar exposes the explicit horizontal focus handles', () => {
  for (const prop of [
    'searchNextFocusLeft',
    'searchNextFocusRight',
    'discoverNextFocusLeft',
    'discoverNextFocusRight',
  ]) {
    assert.match(toolbar, new RegExp(prop));
  }
  assert.match(toolbar, /nextFocusLeft: searchNextFocusLeft/);
  assert.match(toolbar, /nextFocusRight: searchNextFocusRight/);
  assert.match(toolbar, /nextFocusLeft: discoverNextFocusLeft/);
  assert.match(toolbar, /nextFocusRight: discoverNextFocusRight/);
});

test('Series wires category ↔ Search ↔ Discover ↔ Sort horizontally', () => {
  assert.match(seriesScreen, /nextFocusRightHandle=\{searchToolbarFocusHandle\}/);
  assert.match(seriesScreen, /sortFocusLeftHandle=\{discoverToolbarFocusHandle \?\? searchToolbarFocusHandle\}/);
  assert.match(seriesScreen, /searchNextFocusLeft=\{categoryFocusLeftHandle\}/);
  assert.match(seriesScreen, /searchNextFocusRight=\{discoverToolbarFocusHandle\}/);
  assert.match(seriesScreen, /discoverNextFocusLeft=\{searchToolbarFocusHandle\}/);
  assert.match(seriesScreen, /discoverNextFocusRight=\{sortFocusRightHandle\}/);
  assert.match(seriesGrid, /nextFocusLeft=\{sortFocusLeftHandle\}/);
});

test('Series toolbar patch adds no vertical overrides', () => {
  const toolbarBlock = seriesScreen.slice(seriesScreen.indexOf('searchNextFocusLeft='), seriesScreen.indexOf('loadMore={loadMore}'));
  assert.doesNotMatch(toolbarBlock, /nextFocusUp|nextFocusDown/);
});

test('Movies wires Sort LEFT to Discovery and Discovery RIGHT to Sort', () => {
  assert.match(moviesScreen, /buttonRef=\{searchToolbarRef\}/);
  assert.match(moviesScreen, /discoverButtonRef=\{discoverToolbarRef\}/);
  assert.match(moviesScreen, /discoverNextFocusRight=\{sortFocusRightHandle\}/);
  assert.match(moviesScreen, /sortFocusLeftHandle=\{discoverToolbarFocusHandle \?\? searchToolbarFocusHandle \?\? categoryFocusLeftHandle\}/);
  assert.match(moviesScreen, /setDiscoverToolbarFocusHandle\(\(current\) => current === discoverHandle \? current : discoverHandle\)/);
});

test('Movies Discovery/Sort wiring preserves existing activation and vertical behavior', () => {
  const toolbarBlock = moviesScreen.slice(moviesScreen.indexOf('<MovieToolbar'), moviesScreen.indexOf('</MovieToolbar>'));
  assert.match(toolbarBlock, /onSearchPress=/);
  assert.match(toolbarBlock, /onDiscoverPress=/);
  assert.doesNotMatch(toolbarBlock, /nextFocusUp|nextFocusDown/);
  assert.doesNotMatch(moviesScreen.slice(moviesScreen.indexOf('sortFocusLeftHandle='), moviesScreen.indexOf('loadMore={loadMore}')), /nextFocusUp|nextFocusDown/);
});
