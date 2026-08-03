import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  beginMoviesSearchInput,
  buildMoviesSearchSql,
  emitMoviesSearchTiming,
  markMoviesSearchCancelled,
  markMoviesSearchDebounceReleased,
  markMoviesSearchPath,
  markMoviesSearchQueryFinished,
  markMoviesSearchStateApplied,
  moviesSearchDiagnosticsContainCredentials,
  resetMoviesSearchPerfDiagnosticsForTests,
} from '../src/features/search/moviesSearchPerfDiagnostics.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('timing stages are recorded for a completed Movies search request', () => {
  resetMoviesSearchPerfDiagnosticsForTests();
  const logs = [];
  const original = console.info;
  console.info = (...args) => {
    logs.push(args.join(' '));
  };
  try {
    const requestId = beginMoviesSearchInput({
      query: 'batman',
      normalizedQueryLength: 6,
      debounceMs: 150,
      previousRequestCancelled: false,
    });
    markMoviesSearchDebounceReleased(requestId);
    markMoviesSearchPath(requestId, 'sqlite', { sqliteMs: 42, mappingMs: 3 });
    markMoviesSearchQueryFinished(requestId, 12);
    markMoviesSearchStateApplied(requestId, 12);
    emitMoviesSearchTiming(requestId);

    const timing = logs.find((line) => line.includes('[NovaCast Movies Search Timing]'));
    assert.ok(timing);
    assert.match(timing, /"sqliteMs":42/);
    assert.match(timing, /"resultCount":12/);
    assert.match(timing, /"cancelled":false/);
    assert.match(timing, /"stale":false/);
    assert.match(timing, /stage-movies-search-perf-audit-v1/);
  } finally {
    console.info = original;
  }
});

test('stale and cancelled requests are identified in diagnostics', () => {
  resetMoviesSearchPerfDiagnosticsForTests();
  const logs = [];
  const original = console.info;
  console.info = (...args) => {
    logs.push(args.join(' '));
  };
  try {
    const staleId = beginMoviesSearchInput({
      query: 'bat',
      normalizedQueryLength: 3,
      debounceMs: 150,
      previousRequestCancelled: false,
    });
    markMoviesSearchCancelled(staleId, 'stale');
    const cancelledId = beginMoviesSearchInput({
      query: 'batman',
      normalizedQueryLength: 6,
      debounceMs: 150,
      previousRequestCancelled: true,
    });
    markMoviesSearchCancelled(cancelledId, 'aborted');

    const staleLine = logs.find((line) => line.includes('"stale":true'));
    const cancelledLine = logs.find((line) => line.includes('"cancelled":true'));
    assert.ok(staleLine);
    assert.ok(cancelledLine);
  } finally {
    console.info = original;
  }
});

test('query plan SQL can be captured safely without credentials', () => {
  const built = buildMoviesSearchSql({
    likePattern: '%batman%',
    limit: 50,
    offset: 0,
  });
  assert.equal(built.table ?? 'catalog_items_v2', 'catalog_items_v2');
  assert.match(built.pageSql, /catalog_items_v2/);
  assert.match(built.pageSql, /normalized_title LIKE \?/);
  assert.match(built.pageSql, /sync_generation = \?/);
  assert.match(built.explainSql, /^EXPLAIN QUERY PLAN /);
  assert.equal(built.usesLeadingWildcard, true);
  assert.equal(moviesSearchDiagnosticsContainCredentials(built.explainSql), false);
  assert.equal(moviesSearchDiagnosticsContainCredentials(JSON.stringify(built)), false);
});

test('diagnostics contain no credentials and no behavior-changing search SQL edits', () => {
  const repository = fs.readFileSync(
    path.join(root, 'src/features/catalog/catalogRepository.ts'),
    'utf8',
  );
  const diagnostics = fs.readFileSync(
    path.join(root, 'src/features/search/moviesSearchPerfDiagnostics.ts'),
    'utf8',
  );
  assert.match(repository, /EXPLAIN QUERY PLAN/);
  assert.match(repository, /normalized_title LIKE \?/);
  assert.match(repository, /%\$\{normalizeCatalogTitle\(query\.query\)\}%/);
  assert.match(diagnostics, /stage-movies-search-perf-audit-v1/);

  const samplePayload = JSON.stringify({
    requestId: 1,
    query: 'batman',
    path: 'sqlite',
    sqliteMs: 10,
    marker: 'stage-movies-search-perf-audit-v1',
  });
  assert.equal(moviesSearchDiagnosticsContainCredentials(samplePayload), false);
  assert.equal(
    moviesSearchDiagnosticsContainCredentials('password=secret get.php?username=x'),
    true,
  );
});

test('Movies search still prefers index then sqlite/provider fallback (no path rewrite)', () => {
  const repo = fs.readFileSync(
    path.join(root, 'src/features/search/repositories/movieSearchRepository.ts'),
    'utf8',
  );
  assert.match(repo, /searchMovieCatalogIndex/);
  assert.match(repo, /dataSource\?\.searchMovies/);
  assert.match(repo, /markMoviesSearchPath/);
});
