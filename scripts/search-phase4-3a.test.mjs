import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const globalSearch = fs.readFileSync(new URL('../src/features/search/repositories/globalSearchRepository.ts', import.meta.url), 'utf8');
const providerBundle = fs.readFileSync(new URL('../src/features/providers/providerBundle.ts', import.meta.url), 'utf8');

test('global movie and series search resolve authoritative local datasources', () => {
  assert.match(globalSearch, /resolveMoviesSearchDatasource\(\{/);
  assert.match(globalSearch, /resolveSeriesSearchDatasource\(\{/);
  assert.match(globalSearch, /selection\.selectedDatasource === 'sqlite-v2'/);
  assert.match(globalSearch, /searchSeriesDataSourceDirect\(/);
  assert.doesNotMatch(globalSearch.slice(globalSearch.indexOf('const tasks'), globalSearch.indexOf('await Promise.all(tasks)')), /searchMovies\(bundle\.providerId, bundle\.movies/);
  assert.doesNotMatch(globalSearch.slice(globalSearch.indexOf('const tasks'), globalSearch.indexOf('await Promise.all(tasks)')), /searchSeries\(bundle\.providerId, bundle\.seriesDataSource/);
});

test('catalog freshness is durable, six-hour stale-while-revalidate, and non-blocking', () => {
  assert.match(providerBundle, /CATALOG_FRESHNESS_MS/);
  assert.match(providerBundle, /lastSuccessfulSyncAt/);
  assert.match(providerBundle, /catalogFreshnessAgeMs/);
  assert.match(providerBundle, /catalogFreshnessAction/);
  assert.match(providerBundle, /void bundle\.syncCatalog\('provider-bundle-stale-while-revalidate'\)/);
  assert.match(providerBundle, /durable-movie-ready-generation-background-refresh/);
});
