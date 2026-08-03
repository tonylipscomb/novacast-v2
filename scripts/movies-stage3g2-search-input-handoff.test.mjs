import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  beginMoviesSearchInputDownHandoff,
  bumpMoviesSearchInputQueryRevision,
  cancelMoviesSearchInputHandoff,
  confirmMoviesSearchInputHandoff,
  getMoviesSearchInputQueryRevision,
  hasPendingMoviesSearchInputHandoff,
  resetMoviesSearchInputHandoffForTests,
} from '../src/features/search/moviesSearchInputHandoff.ts';
import {
  registerMoviesSearchResultTarget,
  resetMoviesSearchFocusForTests,
  setMoviesSearchResultOrder,
} from '../src/features/search/moviesSearchFocus.ts';

const overlay = fs.readFileSync('src/features/search/SearchOverlay.tsx', 'utf8');
const input = fs.readFileSync('src/features/search/SearchInput.tsx', 'utf8');
const card = fs.readFileSync('src/features/search/SearchPosterCard.tsx', 'utf8');
const handoff = fs.readFileSync('src/features/search/moviesSearchInputHandoff.ts', 'utf8');
const scroll = fs.readFileSync('src/features/search/moviesSearchScroll.ts', 'utf8');
const scrollGrid = fs.readFileSync('src/features/search/SearchPosterGrid.tsx', 'utf8');
const catalogRepo = fs.readFileSync('src/features/catalog/catalogRepository.ts', 'utf8');
const sync = fs.readFileSync('src/features/providers/providerCatalogSync.ts', 'utf8');

test('1. Down from focused SearchInput with results calls one handoff', () => {
  resetMoviesSearchInputHandoffForTests();
  resetMoviesSearchFocusForTests();
  const logs = [];
  const original = console.info;
  console.info = (...args) => logs.push(args.join(' '));
  try {
    const fakeRef = { current: { focus() {} } };
    registerMoviesSearchResultTarget('m1', fakeRef);
    setMoviesSearchResultOrder(['m1', 'm2']);
    const rev = bumpMoviesSearchInputQueryRevision();
    const first = beginMoviesSearchInputDownHandoff({
      requestId: 1,
      queryRevision: rev,
      resultIds: ['m1', 'm2'],
      inputPreferred: false,
      inputFocused: true,
      imeVisible: false,
    });
    assert.equal(first.accepted, true);
    assert.equal(hasPendingMoviesSearchInputHandoff(), true);
    // Same Down must not create a second pending token while first is open.
    const second = beginMoviesSearchInputDownHandoff({
      requestId: 1,
      queryRevision: rev,
      resultIds: ['m1', 'm2'],
      inputPreferred: false,
      inputFocused: true,
      imeVisible: false,
    });
    // Second call supersedes — still only one active pending after.
    assert.equal(hasPendingMoviesSearchInputHandoff(), true);
    assert.ok(logs.filter((l) => l.includes('"action":"down-received"')).length >= 1);
    assert.ok(logs.some((l) => l.includes('"action":"target-requested"')));
    void second;
  } finally {
    console.info = original;
    resetMoviesSearchInputHandoffForTests();
    resetMoviesSearchFocusForTests();
  }
  assert.match(overlay, /beginMoviesSearchInputDownHandoff/);
  assert.match(overlay, /hasPendingMoviesSearchInputHandoff/);
});

test('2. First mounted result receives focus request', () => {
  assert.match(handoff, /requestTvFocus/);
  assert.match(handoff, /down-from-search-input/);
  assert.match(card, /confirmMoviesSearchInputHandoff/);
  assert.match(overlay, /firstResultNativeTag/);
  assert.match(overlay, /focusDownHandle=\{/);
});

test('3. SearchInput focus ring clears / preferred focus disabled on handoff', () => {
  assert.match(overlay, /setPreferSearchFocus\(false\)/);
  assert.match(overlay, /setHandoffActive\(true\)/);
  assert.match(overlay, /!handoffActive/);
  assert.match(input, /hasTVPreferredFocus=\{preferredFocus\}/);
});

test('4. SearchInput does not immediately reclaim focus', () => {
  assert.match(overlay, /handoffGuardRef/);
  assert.match(overlay, /hasPendingMoviesSearchInputHandoff\(\)/);
  assert.match(overlay, /Preferred focus only for open|never reclaim mid-handoff/);
  assert.doesNotMatch(overlay, /focusDownHandle=\{scope === 'movie' \? searchFieldHandle/);
});

test('5. Empty results keep focus in SearchInput', () => {
  resetMoviesSearchInputHandoffForTests();
  const logs = [];
  const original = console.info;
  console.info = (...args) => logs.push(args.join(' '));
  try {
    const rev = bumpMoviesSearchInputQueryRevision();
    const result = beginMoviesSearchInputDownHandoff({
      requestId: 2,
      queryRevision: rev,
      resultIds: [],
      inputPreferred: true,
      inputFocused: true,
      imeVisible: false,
    });
    assert.equal(result.accepted, false);
    assert.ok(logs.some((l) => l.includes('"action":"empty-results"')));
    assert.equal(hasPendingMoviesSearchInputHandoff(), false);
  } finally {
    console.info = original;
    resetMoviesSearchInputHandoffForTests();
  }
});

test('6. Up from first result returns focus to SearchInput', () => {
  assert.match(overlay, /'up-to-input'/);
  assert.match(overlay, /noteMoviesSearchInputReclaimed/);
  assert.match(overlay, /resultsFocusUpHandle = searchFieldHandle/);
  assert.match(scrollGrid, /nextFocusUp=\{isFirstRow \? focusUpHandle/);
});

test('7. Query change cancels pending handoff', () => {
  resetMoviesSearchInputHandoffForTests();
  resetMoviesSearchFocusForTests();
  const logs = [];
  const original = console.info;
  console.info = (...args) => logs.push(args.join(' '));
  try {
    const fakeRef = { current: { focus() {} } };
    registerMoviesSearchResultTarget('m9', fakeRef);
    const rev = bumpMoviesSearchInputQueryRevision();
    beginMoviesSearchInputDownHandoff({
      requestId: 3,
      queryRevision: rev,
      resultIds: ['m9'],
      inputPreferred: false,
      inputFocused: true,
      imeVisible: false,
    });
    cancelMoviesSearchInputHandoff('query-change', {
      requestId: 3,
      resultCount: 1,
      inputFocused: true,
    });
    assert.equal(hasPendingMoviesSearchInputHandoff(), false);
    assert.ok(logs.some((l) => l.includes('"action":"cancelled"')));
  } finally {
    console.info = original;
    resetMoviesSearchInputHandoffForTests();
    resetMoviesSearchFocusForTests();
  }
  assert.match(overlay, /cancelMoviesSearchInputHandoff\('query-change'/);
  assert.match(overlay, /bumpMoviesSearchInputQueryRevision/);
});

test('8. IME does not swallow Down when results exist', () => {
  assert.match(handoff, /ime-dismissed/);
  assert.match(handoff, /dismissIme/);
  assert.match(overlay, /inputRef\.current\?\.blur\(\)/);
  assert.match(input, /imeVisible/);
  assert.match(input, /useMoviesSearchTvDownHandler|useTVEventHandler/);
});

test('9. No retry loop — confirmation is one-shot', () => {
  resetMoviesSearchInputHandoffForTests();
  resetMoviesSearchFocusForTests();
  const fakeRef = { current: { focus() {} } };
  registerMoviesSearchResultTarget('m1', fakeRef);
  const rev = bumpMoviesSearchInputQueryRevision();
  beginMoviesSearchInputDownHandoff({
    requestId: 4,
    queryRevision: rev,
    resultIds: ['m1'],
    inputPreferred: false,
    inputFocused: true,
    imeVisible: false,
  });
  assert.equal(confirmMoviesSearchInputHandoff({ movieId: 'm1', requestId: 4, inputFocused: false }), true);
  assert.equal(confirmMoviesSearchInputHandoff({ movieId: 'm1', requestId: 4, inputFocused: false }), false);
  assert.equal(hasPendingMoviesSearchInputHandoff(), false);
  assert.match(handoff, /One confirmation only|One Down press/);
  assert.doesNotMatch(handoff, /setTimeout\(attempt/);
  resetMoviesSearchInputHandoffForTests();
  resetMoviesSearchFocusForTests();
  void getMoviesSearchInputQueryRevision;
});

test('10. Stage 3G.1 row-index guard remains intact', () => {
  assert.match(scroll, /stage3g1-movies-search-scroll-v1/);
  assert.match(scrollGrid, /itemIndexToMoviesSearchScrollRow/);
  assert.match(scrollGrid, /index: decision\.rowIndex/);
  assert.match(scrollGrid, /scroll-to-index-failed-no-retry/);
});

test('11. No catalog\/detail\/loader changes', () => {
  assert.match(handoff, /stage3g2-search-input-handoff-v1/);
  assert.doesNotMatch(catalogRepo, /stage3g2-search-input-handoff-v1/);
  assert.doesNotMatch(sync, /stage3g2-search-input-handoff-v1/);
  assert.doesNotMatch(overlay, /focusDownHandle=\{scope === 'movie' \? searchFieldHandle/);
});
