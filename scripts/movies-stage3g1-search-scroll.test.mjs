import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  decideMoviesSearchScrollExecution,
  getMoviesSearchScrollListLength,
  itemIndexToMoviesSearchScrollRow,
  planMoviesSearchScroll,
} from '../src/features/search/moviesSearchScroll.ts';

const grid = fs.readFileSync('src/features/search/SearchPosterGrid.tsx', 'utf8');
const scrollModule = fs.readFileSync('src/features/search/moviesSearchScroll.ts', 'utf8');
const moviesGrid = fs.readFileSync('src/features/movies/components/MoviePosterGrid.tsx', 'utf8');
const moviesScreen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');

test('1. every SearchPosterGrid scrollToIndex caller is identified and guarded', () => {
  // Single programmatic call site; failure path drops instead of retrying via scrollToOffset.
  assert.equal((grid.match(/\.scrollToIndex\(/g) ?? []).length, 1);
  assert.match(grid, /onScrollToIndexFailed/);
  assert.match(grid, /decideMoviesSearchScrollExecution/);
  assert.match(grid, /itemIndexToMoviesSearchScrollRow/);
  assert.match(grid, /try \{/);
  assert.match(grid, /logMoviesSearchScroll/);
  assert.match(grid, /scroll-to-index-failed-no-retry/);
  // Must scroll by ROW index (numColumns), not item index.
  assert.match(grid, /index: decision\.rowIndex/);
  assert.doesNotMatch(grid, /scrollToIndex\(\{\s*index,\s*animated/);
});

test('2. results shrink from 20→4 while scroll pending drops stale scroll', () => {
  const columns = 5;
  // 20 items → 4 rows (0..3). Pending scroll to row 3 is valid initially.
  assert.equal(getMoviesSearchScrollListLength(20, columns), 4);
  const pending = {
    requestId: 10,
    queryRevision: 1,
    rowIndex: itemIndexToMoviesSearchScrollRow(15, columns), // item 15 → row 3
    reason: 'focus-keep-visible',
  };
  assert.equal(pending.rowIndex, 3);

  const before = decideMoviesSearchScrollExecution({
    pending,
    activeRequestId: 10,
    activeQueryRevision: 1,
    itemCount: 20,
    columns,
    cellsReadyThroughRow: 3,
  });
  assert.equal(before.action, 'execute');

  // Shrink to 4 items → 1 row (0..0). Row 3 is invalid.
  assert.equal(getMoviesSearchScrollListLength(4, columns), 1);
  const after = decideMoviesSearchScrollExecution({
    pending,
    activeRequestId: 10,
    activeQueryRevision: 1,
    itemCount: 4,
    columns,
    cellsReadyThroughRow: 3,
  });
  assert.equal(after.action, 'drop');
  assert.equal(after.reason, 'index-out-of-range');
});

test('3. query replacement cancels old scroll', () => {
  const pending = {
    requestId: 3,
    queryRevision: 7,
    rowIndex: 1,
    reason: 'focus-keep-visible',
  };
  const decision = decideMoviesSearchScrollExecution({
    pending,
    activeRequestId: 3,
    activeQueryRevision: 8, // query replaced
    itemCount: 20,
    columns: 5,
    cellsReadyThroughRow: 2,
  });
  assert.equal(decision.action, 'drop');
  assert.equal(decision.reason, 'query-revision-changed');
});

test('4. invalid index never plans as executable', () => {
  // Classic fatal: item index 5 with 5 columns → ROW 1 is valid when length>=2,
  // but passing item index 5 as scroll index against 4 rows would be out of range.
  const row = itemIndexToMoviesSearchScrollRow(5, 5);
  assert.equal(row, 1);

  const badAsItemIndex = planMoviesSearchScroll({
    rowIndex: 5, // incorrectly using item index as row
    itemCount: 20, // 4 rows → max index 3
    columns: 5,
    requestId: 1,
    activeRequestId: 1,
    queryRevision: 1,
    activeQueryRevision: 1,
  });
  assert.equal(badAsItemIndex.ok, false);
  assert.equal(badAsItemIndex.reason, 'index-out-of-range');
  assert.equal(badAsItemIndex.listLength, 4);

  const goodRow = planMoviesSearchScroll({
    rowIndex: row,
    itemCount: 20,
    columns: 5,
    requestId: 1,
    activeRequestId: 1,
    queryRevision: 1,
    activeQueryRevision: 1,
  });
  assert.equal(goodRow.ok, true);
  assert.equal(goodRow.rowIndex, 1);
});

test('5. no React Native Invariant Violation path (no unguarded scrollToOffset retry)', () => {
  assert.doesNotMatch(grid, /scrollToOffset\(\{/);
  assert.match(grid, /Do not retry|no-retry|dropped: true/);
  assert.match(scrollModule, /stage3g1-movies-search-scroll-v1/);
  assert.match(scrollModule, /\[NovaCast Movies Search Scroll\]/);
});

test('6. search focus handoff wiring remains intact', () => {
  const overlay = fs.readFileSync('src/features/search/SearchOverlay.tsx', 'utf8');
  const focus = fs.readFileSync('src/features/search/moviesSearchFocus.ts', 'utf8');
  const handoff = fs.readFileSync('src/features/search/moviesSearchInputHandoff.ts', 'utf8');
  assert.match(overlay, /beginMoviesSearchInputDownHandoff/);
  assert.match(overlay, /onDown=\{scope === 'movie' \? handleSearchDown/);
  assert.match(handoff, /down-from-search-input|target-requested/);
  assert.match(focus, /down-from-input|registerMoviesSearchResultTarget/);
  assert.match(grid, /onFocus=\{\(\) => handleFocus\(key, index\)\}/);
});

test('7. D-pad nextFocus wiring remains intact', () => {
  assert.match(grid, /nextFocusUp=\{isFirstRow \? focusUpHandle/);
  assert.match(grid, /nextFocusLeft=\{isFirstColumn \? focusLeftHandle/);
  assert.match(grid, /focusable|SearchPosterCard/);
});

test('8. browse restore unaffected (still uses scrollToOffset in MoviePosterGrid)', () => {
  assert.match(moviesGrid, /scrollToOffset/);
  assert.match(moviesScreen, /restore-after-search-close|focusSelectedPoster/);
  // Stage 3G.1 must not rewrite browse grid scroll helpers.
  assert.doesNotMatch(moviesGrid, /stage3g1-movies-search-scroll-v1/);
});

test('9. requestId change drops pending scroll', () => {
  const decision = decideMoviesSearchScrollExecution({
    pending: {
      requestId: 1,
      queryRevision: 1,
      rowIndex: 0,
      reason: 'focus-keep-visible',
    },
    activeRequestId: 2,
    activeQueryRevision: 1,
    itemCount: 20,
    columns: 5,
    cellsReadyThroughRow: 0,
  });
  assert.equal(decision.action, 'drop');
  assert.equal(decision.reason, 'request-id-changed');
});

test('10. cells-not-ready waits instead of calling FlatList', () => {
  const decision = decideMoviesSearchScrollExecution({
    pending: {
      requestId: 4,
      queryRevision: 2,
      rowIndex: 2,
      reason: 'focus-keep-visible',
    },
    activeRequestId: 4,
    activeQueryRevision: 2,
    itemCount: 20,
    columns: 5,
    cellsReadyThroughRow: 0,
  });
  assert.equal(decision.action, 'wait');
  assert.equal(decision.reason, 'cells-not-ready');
});
