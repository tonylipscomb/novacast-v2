import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  getLiveTvWorkload,
  patchLiveTvWorkload,
  resetLiveTvWorkloadForTests,
} from '../src/features/live/liveTvWorkload.ts';
import { getCatalogBackgroundWriteYield, resetCatalogForegroundPriorityForTests, setCatalogUiSurface } from '../src/features/catalog/catalogForegroundPriority.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const diagnostics = read('src/features/search/liveSearchDiagnostics.ts');
const overlay = read('src/features/search/SearchOverlay.tsx');
const controller = read('src/features/search/useSearchController.ts');
const repository = read('src/features/search/repositories/liveSearchRepository.ts');
const sqlite = read('src/features/search/liveSearchSqliteCatalog.ts');

test('release-safe Search diagnostics contain no query or provider payload fields', () => {
  assert.match(diagnostics, /queryLength/);
  assert.match(diagnostics, /NOVACAST_LIVE_SEARCH/);
  assert.doesNotMatch(diagnostics, /query\s*:/);
  assert.doesNotMatch(diagnostics, /channelName|streamUrl|providerId|password|username|authorization/);
});

test('Search lifecycle instrumentation covers input, filtering, rendering, and focus', () => {
  for (const event of [
    'search-open', 'input-received', 'query-state-updated', 'debounce-fire', 'filter-start',
    'filter-complete', 'results-render-start', 'results-render-complete',
    'first-result-focus', 'search-close',
  ]) {
    assert.match(diagnostics, new RegExp(`'${event}'`));
  }
  assert.match(overlay, /recordLiveSearchDiagnostic\('search-open'/);
  assert.match(overlay, /recordLiveSearchDiagnostic\('input-received'/);
  assert.match(controller, /recordLiveSearchDiagnostic\('query-state-updated'/);
  assert.match(controller, /recordLiveSearchDiagnostic\('results-render-start'/);
  assert.match(repository, /recordLiveSearchDiagnostic\('filter-start'/);
  assert.match(sqlite, /recordLiveSearchDiagnostic\('filter-complete'/);
});

test('Search foreground priority pauses index work and resumes after close', () => {
  resetLiveTvWorkloadForTests();
  resetCatalogForegroundPriorityForTests();
  setCatalogUiSurface('live');
  patchLiveTvWorkload({ activeScreen: 'live', searchOverlayVisible: true });
  assert.equal(getLiveTvWorkload().searchOverlayVisible, true);
  assert.deepEqual(getCatalogBackgroundWriteYield(), { pauseMs: 300, reason: 'live-search-foreground' });
  patchLiveTvWorkload({ searchOverlayVisible: false });
  assert.notEqual(getCatalogBackgroundWriteYield().reason, 'live-search-foreground');
  resetLiveTvWorkloadForTests();
  resetCatalogForegroundPriorityForTests();
});

test('Live Search uses the published SQLite query before indexed/provider fallback', () => {
  const sqlitePath = sqlite.indexOf('searchLiveSqliteCatalog');
  const fallbackPath = repository.indexOf('searchLiveChannelIndex');
  assert.ok(sqlitePath >= 0);
  assert.ok(fallbackPath >= 0);
  assert.match(sqlite, /ORDER BY/);
  assert.match(sqlite, /LIMIT \? OFFSET \?/);
  assert.match(repository, /scheduleLiveSearchCatalogIdleBuild/);
});

console.log('live-search-performance-diagnostics: assertions passed');
