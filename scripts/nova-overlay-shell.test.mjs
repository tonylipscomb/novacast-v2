import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');
const shell = read('src/components/nova/NovaOverlayShell.tsx');
const search = read('src/features/search/SearchOverlay.tsx');
const movie = read('src/features/movies/components/MovieDetailPopupV2.tsx');
const series = read('src/features/series/components/SeriesDetailPopupV2.tsx');

test('major overlay shell preserves the Live Search frame contract', () => {
  assert.match(shell, /backgroundColor: 'rgba\(7, 9, 22, 0\.88\)'/);
  assert.match(shell, /borderColor: 'rgba\(130, 145, 220, 0\.34\)'/);
  assert.match(shell, /borderRadius: 26/);
  assert.match(shell, /shadowColor: '#4c5cff'/);
  assert.match(shell, /shadowOpacity: 0\.22/);
  assert.match(shell, /shadowRadius: 18/);
  assert.match(shell, /elevation: 12/);
});

test('major overlay shell is presentation-only and non-focusable', () => {
  assert.match(shell, /<View focusable=\{false\} accessible=\{false\}/);
  assert.doesNotMatch(shell, /onPress|onFocus|hasTVPreferredFocus/);
});

test('Search, Movies V2, and Series V2 use the shared shell', () => {
  assert.match(search, /<NovaOverlayShell/);
  assert.match(movie, /<NovaOverlayShell/);
  assert.match(series, /<NovaOverlayShell/);
});
