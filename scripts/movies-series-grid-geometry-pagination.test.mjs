import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const movieGrid = fs.readFileSync('src/features/movies/components/MoviePosterGrid.tsx', 'utf8');
const movieCard = fs.readFileSync('src/features/movies/components/MoviePosterCard.tsx', 'utf8');
const seriesGrid = fs.readFileSync('src/features/series/components/SeriesPosterGrid.tsx', 'utf8');
const moviesScreen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');

test('Movies grid derives card width from its measured stage', () => {
  assert.match(movieGrid, /onLayout=\{\(event: LayoutChangeEvent\) =>/);
  assert.match(movieGrid, /gridWidth -[\s\S]{0,180}gap \* Math\.max\(0, columns - 1\)/);
  assert.doesNotMatch(movieGrid, /width - 320/);
});

test('Series grid accounts for padding and gaps inside the measured stage', () => {
  assert.match(seriesGrid, /effectiveGridWidth -[\s\S]{0,220}SERIES_GRID_COLUMN_GAP \* Math\.max\(0, columns - 1\)/);
  assert.match(seriesGrid, /SERIES_GRID_LEFT_PADDING \+\s*SERIES_GRID_RIGHT_PADDING/);
});

test('Both grids use non-growing cells and left-aligned rows', () => {
  assert.match(movieGrid, /row:[\s\S]{0,180}justifyContent: 'flex-start'/);
  assert.match(movieGrid, /cell:[\s\S]{0,120}flexGrow: 0[\s\S]{0,80}flexShrink: 0/);
  assert.match(seriesGrid, /flexGrow: 0, flexShrink: 0/);
});

test('Movie pagination preserves the existing FlatList identity', () => {
  assert.match(movieGrid, /key=\{columns\}/);
  assert.match(movieGrid, /keyExtractor=\{keyExtractor\}/);
  assert.doesNotMatch(movieGrid, /key=\{[^}]*movies\.length/);
});

test('Movie poster ref callback stays stable when last-row trapping changes', () => {
  assert.match(movieCard, /const trapFocusDownRef = useRef\(trapFocusDown\)/);
  assert.match(movieCard, /trapFocusDownRef\.current = trapFocusDown/);
  assert.match(movieCard, /\[instanceToken, registerRef\]/);
});

test('Movie category focus restoration remains scoped to category loading', () => {
  assert.match(moviesScreen, /categoryFocusPendingRef\.current/);
  assert.match(moviesScreen, /categoryLoading \|\| loadStatus === 'loading'/);
  assert.match(moviesScreen, /focus-first-movies-after-category/);
});
