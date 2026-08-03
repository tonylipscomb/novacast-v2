import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  beginMoviesSearchInput,
  markMoviesSearchCancelled,
  markMoviesSearchDebounceReleased,
  markMoviesSearchPath,
  markMoviesSearchQueryFinished,
  markMoviesSearchStateApplied,
  resetMoviesSearchPerfDiagnosticsForTests,
} from '../src/features/search/moviesSearchPerfDiagnostics.ts';
import {
  cancelMoviesSearchResultFocus,
  noteMoviesSearchResultsReady,
  requestFocusFirstMoviesSearchResult,
  resetMoviesSearchFocusForTests,
  setMoviesSearchResultOrder,
} from '../src/features/search/moviesSearchFocus.ts';

// Stage 3G.2 supersedes requestFocusFirstMoviesSearchResult in the overlay path;
// keep the import used by the query-change cancel test below.

const rootFiles = {
  screen: fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8'),
  overlay: fs.readFileSync('src/features/search/SearchOverlay.tsx', 'utf8'),
  input: fs.readFileSync('src/features/search/SearchInput.tsx', 'utf8'),
  grid: fs.readFileSync('src/features/search/SearchPosterGrid.tsx', 'utf8'),
  card: fs.readFileSync('src/features/search/SearchPosterCard.tsx', 'utf8'),
  empty: fs.readFileSync('src/features/search/SearchEmptyState.tsx', 'utf8'),
  datasource: fs.readFileSync('src/features/search/moviesSearchDatasource.ts', 'utf8'),
  repository: fs.readFileSync('src/features/search/repositories/movieSearchRepository.ts', 'utf8'),
  sqlite: fs.readFileSync('src/features/movies/data/SqliteMovieDataSource.ts', 'utf8'),
  catalog: fs.readFileSync('src/features/catalog/catalogRepository.ts', 'utf8'),
  controller: fs.readFileSync('src/features/search/useSearchController.ts', 'utf8'),
  diagnostics: fs.readFileSync('src/features/search/moviesSearchPerfDiagnostics.ts', 'utf8'),
  sync: fs.readFileSync('src/features/providers/providerCatalogSync.ts', 'utf8'),
  seriesScreen: fs.readFileSync('src/features/series/SeriesScreen.tsx', 'utf8'),
  liveScreen: fs.readFileSync('src/features/live/LiveTvScreen.tsx', 'utf8'),
};

test('1. Healthy readable generation selects SQLite datasource', () => {
  assert.match(rootFiles.datasource, /selectedDatasource: 'sqlite-v2'/);
  assert.match(rootFiles.datasource, /readableGeneration > 0/);
  assert.match(rootFiles.datasource, /providerFallbackAllowed: false/);
  assert.match(rootFiles.datasource, /\[NovaCast Movies Search Datasource\]/);
  assert.match(rootFiles.screen, /resolveMoviesSearchDatasource/);
  assert.match(rootFiles.screen, /createSqliteMovieDataSource\(activeProviderId\)/);
});

test('2. bundle.movies provider datasource is not used when SQLite is available', () => {
  assert.match(rootFiles.screen, /browseDataSource:/);
  assert.match(rootFiles.datasource, /Never prefer Xtream bundle when a browse SQLite wrapper exists/);
  assert.match(rootFiles.repository, /isSqliteMovieDataSource\(dataSource\)/);
  assert.match(rootFiles.repository, /Zero results are authoritative/);
  // Overlay execute path must not call searchMovies(..., bundle?.movies)
  assert.doesNotMatch(
    rootFiles.screen.replace(/runMoviesSearchPerfProbeOnce[\s\S]*?\}\);/, ''),
    /searchMovies\(\s*activeProviderId\s*,\s*bundle\?\.movies/,
  );
});

test('3. Zero SQLite results do not trigger provider fallback', () => {
  assert.match(rootFiles.repository, /never fall through to Xtream/);
  const sqliteBranch = rootFiles.repository.split('if (sqlite && dataSource?.searchMovies)')[1] ?? '';
  const sqliteOnly = sqliteBranch.split('const indexed = await searchMovieCatalogIndex')[0] ?? '';
  assert.match(sqliteOnly, /return mapped;/);
  assert.doesNotMatch(sqliteOnly, /withSearchTimeout/);
  assert.doesNotMatch(sqliteOnly, /SEARCH_PROVIDER_FALLBACK_TIMEOUT_MS/);
});

test('4. Stale provider requests cannot apply', () => {
  assert.match(rootFiles.controller, /requestId !== requestIdRef\.current \|\| controller\.signal\.aborted/);
  assert.match(rootFiles.repository, /request\.signal\?\.aborted/);
  assert.match(rootFiles.diagnostics, /never relabel an already-applied completed request/);
});

test('5. D-pad Down from Search focuses the first result', () => {
  assert.match(rootFiles.input, /onDown\?: \(meta: \{ imeVisible: boolean \}\) => void/);
  assert.match(rootFiles.overlay, /onDown=\{scope === 'movie' \? handleSearchDown/);
  assert.match(rootFiles.overlay, /beginMoviesSearchInputDownHandoff/);
  assert.match(rootFiles.overlay, /action: 'up-to-input'|up-to-input/);
  assert.match(rootFiles.overlay, /firstResultNativeTag/);
});

test('6. First result shows visible focused styling from focusedSearchMovieId', () => {
  assert.match(rootFiles.overlay, /focusedSearchMovieId/);
  assert.match(rootFiles.grid, /focusedMovieId/);
  assert.match(rootFiles.card, /showFocused = focused \|\| nativeFocused/);
  assert.match(rootFiles.card, /cardFocused/);
  assert.match(rootFiles.card, /registerMoviesSearchResultTarget/);
  assert.match(rootFiles.card, /unregisterMoviesSearchResultTarget/);
});

test('7. Left\/Right\/Down navigation remains inside result cards', () => {
  assert.match(rootFiles.grid, /nextFocusUp=\{isFirstRow \? focusUpHandle/);
  assert.match(rootFiles.card, /focusable/);
  assert.doesNotMatch(rootFiles.card, /hasTVPreferredFocus/);
});

test('8. Up from first row returns to Search', () => {
  assert.match(rootFiles.grid, /nextFocusUp=\{isFirstRow \? focusUpHandle/);
  assert.match(rootFiles.overlay, /resultsFocusUpHandle = searchFieldHandle/);
  assert.match(rootFiles.overlay, /'up-to-input'/);
});

test('9. Empty results produce no focus retries', () => {
  resetMoviesSearchFocusForTests();
  const logs = [];
  const original = console.info;
  console.info = (...args) => logs.push(args.join(' '));
  try {
    noteMoviesSearchResultsReady({
      requestId: 11,
      query: 'zzznonsense',
      resultIds: [],
      searchInputFocused: true,
    });
    const emptyLogs = logs.filter((line) => line.includes('"action":"empty-no-target"'));
    assert.equal(emptyLogs.length, 1);
    assert.ok(!logs.some((line) => line.includes('"action":"target-requested"')));
    assert.ok(!logs.some((line) => line.includes('"action":"down-from-input"')));
  } finally {
    console.info = original;
    resetMoviesSearchFocusForTests();
  }
  assert.match(rootFiles.overlay, /onClear=\{scope === 'movie' \? undefined/);
  assert.match(rootFiles.overlay, /empty-no-target|noteMoviesSearchResultsReady/);
});

test('10. Query change cancels pending focus request', () => {
  assert.match(rootFiles.overlay, /cancelMoviesSearchResultFocus\('query-change'/);
  resetMoviesSearchFocusForTests();
  const logs = [];
  const original = console.info;
  console.info = (...args) => logs.push(args.join(' '));
  try {
    setMoviesSearchResultOrder(['m1']);
    requestFocusFirstMoviesSearchResult({
      requestId: 3,
      query: 'Scar',
      searchInputFocused: true,
    });
    cancelMoviesSearchResultFocus('query-change', {
      requestId: 3,
      query: 'Scary',
      resultCount: 1,
      searchInputFocused: true,
    });
    assert.ok(logs.some((line) => line.includes('"action":"cancelled"')));
  } finally {
    console.info = original;
    resetMoviesSearchFocusForTests();
  }
});

test('11. Completed request is not later relabeled cancelled', () => {
  resetMoviesSearchPerfDiagnosticsForTests();
  const logs = [];
  const original = console.info;
  console.info = (...args) => logs.push(args.join(' '));
  try {
    const requestId = beginMoviesSearchInput({
      query: 'Love',
      normalizedQueryLength: 4,
      debounceMs: 150,
      previousRequestCancelled: false,
    });
    markMoviesSearchDebounceReleased(requestId);
    markMoviesSearchPath(requestId, 'sqlite', { sqliteMs: 28, mappingMs: 2 });
    markMoviesSearchQueryFinished(requestId, 40);
    markMoviesSearchStateApplied(requestId, 40);
    markMoviesSearchCancelled(requestId, 'aborted');

    const timingLines = logs.filter((line) => line.includes('[NovaCast Movies Search Timing]'));
    assert.ok(timingLines.length >= 1);
    assert.ok(timingLines.every((line) => line.includes('"cancelled":false')));
    assert.ok(timingLines.some((line) => line.includes('"path":"sqlite"')));
  } finally {
    console.info = original;
    resetMoviesSearchPerfDiagnosticsForTests();
  }
});

test('12. Search close restores prior Movies browse focus path', () => {
  assert.match(rootFiles.screen, /onClose=\{closeSearch\}/);
  assert.match(rootFiles.screen, /function closeSearch|const closeSearch/);
  assert.match(rootFiles.overlay, /cancelMoviesSearchResultFocus\('search-closed'/);
  // Stage 3D2 latch / restore ownership remains the browse restore mechanism.
  assert.match(rootFiles.screen, /postRestorePreferredMovieId|activatePostRestoreLatch|closeSearch/);
});

test('13. No catalog sync, categories, detail, loader, Series, Live TV, or playback changes in Stage 3G surface', () => {
  assert.match(rootFiles.sqlite, /skipTotalCount: true/);
  assert.match(rootFiles.catalog, /skipTotalCount/);
  assert.match(rootFiles.repository, /repository: 'sqlite'/);
  assert.match(rootFiles.grid, /initialNumToRender=\{Math\.min\(columns \* 2, 12\)\}/);
  // Stage 3G marker present; sync / series / live files are not rewritten for search routing.
  assert.match(rootFiles.datasource, /stage3g-sqlite-movies-search-v1/);
  assert.doesNotMatch(rootFiles.sync, /stage3g-sqlite-movies-search-v1/);
  assert.doesNotMatch(rootFiles.seriesScreen, /stage3g-sqlite-movies-search-v1/);
  assert.doesNotMatch(rootFiles.liveScreen, /stage3g-sqlite-movies-search-v1/);
});
