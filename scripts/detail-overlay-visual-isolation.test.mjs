import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file) => readFileSync(file, 'utf8');
const movie = read('src/features/movies/components/MovieDetailPopupV2.tsx');
const series = read('src/features/series/components/SeriesDetailPopupV2.tsx');
const searchLayer = read('src/features/search/SearchMediaDetailLayer.tsx');
const shell = read('src/components/nova/NovaOverlayShell.tsx');

function assertVisualIsolation(source, label) {
  assert.match(source, /style=\{\[StyleSheet\.absoluteFill, styles\.overlay\]\}/, `${label} needs an explicit overlay layer`);
  assert.match(source, /overlay:\s*\{[\s\S]{0,120}zIndex: 100[\s\S]{0,120}elevation: 100/, `${label} needs Android stacking priority`);
  assert.match(source, /<View style=\{\[StyleSheet\.absoluteFill, styles\.scrim\]\} pointerEvents="none" \/>/, `${label} needs a non-interactive full-screen scrim`);
  assert.match(source, /rgba\(0, 0, 0, 0\.72\)/, `${label} needs the strengthened scrim`);
  assert.match(source, /<FocusBoundaryView[\s\S]{0,420}trapFocusLeft: true[\s\S]{0,220}trapFocusRight: true/, `${label} focus boundary must remain intact`);
  assert.doesNotMatch(source, /<Modal\b/, `${label} must not introduce a nested native modal`);
}

test('Movie detail visually isolates browse content', () => assertVisualIsolation(movie, 'Movie detail'));
test('Series detail visually isolates browse content', () => assertVisualIsolation(series, 'Series detail'));
test('Search routes movie and series details through the V2 popup layer', () => {
  assert.match(searchLayer, /<MovieDetailPopupV2/);
  assert.match(searchLayer, /<SeriesDetailPopupV2/);
  assert.match(searchLayer, /const visible = detailOpen && !playbackUiActive/);
});
test('Shared glass shell remains unchanged', () => {
  assert.match(shell, /backgroundColor: 'rgba\(7, 9, 22, 0\.88\)'/);
  assert.match(shell, /borderRadius: 26/);
  assert.match(shell, /elevation: 12/);
});
test('Detail roots remain modal and input-owning while open', () => {
  assert.match(movie, /testID="movie-detail-popup-v2"[\s\S]{0,100}accessibilityViewIsModal/);
  assert.match(series, /testID="series-detail-popup-v2"[\s\S]{0,100}accessibilityViewIsModal/);
  assert.match(movie, /style=\{\[StyleSheet\.absoluteFill, styles\.overlay\]\}[\s\S]{0,100}pointerEvents="auto"/);
  assert.match(series, /style=\{\[StyleSheet\.absoluteFill, styles\.overlay\]\}[\s\S]{0,100}pointerEvents="auto"/);
});
