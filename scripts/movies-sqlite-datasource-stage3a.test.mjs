import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const file = fs.readFileSync(
  new URL('../src/features/movies/data/SqliteMovieDataSource.ts', import.meta.url),
  'utf8',
);

test('SQLite Movies data source is local-only and bounded', () => {
  assert.match(file, /getCatalogItemsPage/);
  assert.match(file, /getCatalogCategoryCounts/);
  assert.match(file, /getCatalogTotalCount/);
  assert.doesNotMatch(file, /get_vod_streams|fetch\(|listCategoryMovies/);
});

test('SQLite Movies data source preserves provider-scoped paging and search', () => {
  assert.match(file, /providerId,/);
  assert.match(file, /mediaType:\s*'movie'/);
  assert.match(file, /offset:\s*input\.offset/);
  assert.match(file, /limit:\s*input\.limit/);
  assert.match(file, /query:\s*input\.query/);
});

test('SQLite Movies data source exposes an explicit readiness check', () => {
  assert.match(file, /isSqliteMovieCatalogReady/);
  assert.match(file, /resolveReadableCatalogGeneration/);
  assert.match(file, /getCatalogTotalCount/);
});
