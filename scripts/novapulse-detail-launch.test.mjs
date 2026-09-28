import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');
const home = read('src/features/hub/MainMenuScreen.tsx');
const movieMemory = read('src/features/movies/moviesScreenMemory.ts');
const movies = read('src/features/movies/MoviesScreen.tsx');
const series = read('src/features/series/SeriesScreen.tsx');
const rail = read('src/features/novapulse/NovaPulseCard.tsx');

test('NovaPulse movie and series details hand off to the existing overlays', () => {
  assert.match(home, /pendingMovieDetail:/);
  assert.match(home, /pendingSeriesDetail:/);
  assert.match(home, /router\.push\('\/movies'\)/);
  assert.match(home, /router\.push\('\/series'\)/);
  assert.match(home, /openDiscoverZone: false/);
  assert.match(movieMemory, /pendingMovieDetail\?: MovieSummary \| null/);
  assert.match(movies, /getMoviesScreenMemory\(activeProviderId\)\.pendingMovieDetail/);
  assert.match(movies, /handleSelectMovie\(pending, 'browse'\)/);
  assert.match(series, /getSeriesScreenMemory\(activeProviderId\)\.pendingSeriesDetail/);
  assert.match(series, /handleSelectSeries\(pending\)/);
});

test('catalog detail actions preserve stable IDs and do not start playback', () => {
  assert.match(home, /const contentId = item\.action\.contentId\?\.trim\(\)/);
  assert.match(home, /const seriesId = item\.action\.seriesId\?\.trim\(\) \|\| contentId/);
  assert.doesNotMatch(home, /handleNovaPulseAction[\s\S]{0,240}startPlayback/);
  assert.match(rail, /const action = providerAlert \? null : resolveNovaPulseAction\(item\)/);
});
