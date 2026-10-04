import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const constants = read('src/features/search/searchConstants.ts');
const controller = read('src/features/search/useSearchController.ts');
const overlay = read('src/features/search/SearchOverlay.tsx');
const results = read('src/features/search/SearchResults.tsx');
const diagnostics = read('src/features/search/liveSearchDiagnostics.ts');
const sqlite = read('src/features/search/liveSearchSqliteCatalog.ts');

test('Live Search uses a shorter Live-only debounce while Movies/Series keep the default', () => {
  assert.match(constants, /SEARCH_DEBOUNCE_MS = 300/);
  assert.match(constants, /LIVE_SEARCH_DEBOUNCE_MS = 150/);
  assert.match(controller, /scope === 'live' \? LIVE_SEARCH_DEBOUNCE_MS : SEARCH_DEBOUNCE_MS/);
});

test('stale Live requests are aborted and cannot overwrite newer results', () => {
  assert.match(controller, /const requestId = \+\+requestIdRef\.current/);
  assert.match(controller, /abortRef\.current\?\.abort\(\)/);
  assert.match(controller, /requestId !== requestIdRef\.current \|\| controller\.signal\.aborted/);
});

test('IME submit targets the first mounted Live result before the search shell', () => {
  assert.match(overlay, /region: 'search-results'[\s\S]{0,260}reason: 'ime-submit-first-result'/);
  assert.match(overlay, /firstLiveResultRef/);
  assert.match(overlay, /reason: 'ime-submit-first-result-pending'/);
  assert.match(overlay, /firstRowRef=\{firstLiveResultRef\}/);
});

test('result focus handoff has a mounted-ref fallback and no focus loop', () => {
  assert.match(overlay, /result-ref-ready/);
  assert.match(overlay, /focus-requested/);
  assert.match(overlay, /imeSubmitFocusPendingRef\.current = false/);
  assert.match(results, /firstRowRef\?: RefObject/);
});

test('keyboard opening remains on the SearchInput path', () => {
  const input = read('src/features/search/SearchInput.tsx');
  assert.match(input, /reason: 'open-native-keyboard'/);
});

test('diagnostics retain index state and expose sanitized focus timings', () => {
  assert.match(diagnostics, /resultsAvailableToFirstFocusMs/);
  assert.match(diagnostics, /inputToDebounceFireMs/);
  assert.match(diagnostics, /imeSubmitToFirstFocusMs/);
  assert.match(diagnostics, /resultRefReadyMs/);
  assert.match(diagnostics, /focusRequestToNativeFocusMs/);
  assert.match(diagnostics, /trace\?\.liveIndexReady === true/);
  assert.doesNotMatch(diagnostics, /query\s*:/);
  assert.doesNotMatch(diagnostics, /streamUrl|password|username|authorization/);
});

test('SQLite search keeps current bounded ranking and pagination semantics', () => {
  assert.match(sqlite, /ORDER BY/);
  assert.match(sqlite, /liveSearchSqlRankCase\(\)/);
  assert.match(sqlite, /LIMIT \? OFFSET \?/);
  assert.match(sqlite, /SELECT COUNT\(\*\) AS total/);
});

console.log('live-search-latency-focus: assertions passed');
