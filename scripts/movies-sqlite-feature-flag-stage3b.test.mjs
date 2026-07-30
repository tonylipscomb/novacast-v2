import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const model = fs.readFileSync(
  new URL('../src/features/movies/useMoviesScreenModel.ts', import.meta.url),
  'utf8',
);
const smart = fs.readFileSync(
  new URL('../src/features/movies/smart/SmartMovieDataSource.ts', import.meta.url),
  'utf8',
);
const sqlite = fs.readFileSync(
  new URL('../src/features/movies/data/SqliteMovieDataSource.ts', import.meta.url),
  'utf8',
);
const contract = fs.readFileSync(
  new URL('../src/features/movies/data/MovieDataSource.ts', import.meta.url),
  'utf8',
);

test('Movies SQLite reads are behind an explicit rollback flag', () => {
  assert.match(model, /EXPO_PUBLIC_MOVIES_SQLITE_READS/);
  assert.match(model, /createSqliteMovieDataSource/);
  assert.match(model, /activeBundle\?\.movies/);
});

test('SQLite provider paging and search remain local while smart categories stay wrapped', () => {
  assert.match(contract, /sourceKind\?: 'legacy' \| 'sqlite'/);
  assert.match(sqlite, /sourceKind:\s*'sqlite'/);
  assert.match(smart, /usesSqliteReads/);
  assert.match(smart, /return base\.searchMovies\(input\)/);
  assert.match(smart, /sourceKind:\s*base\.sourceKind/);
});

test('provider category counts can use SQLite category counts without a legacy index', () => {
  assert.match(smart, /getCategoryCountFromIndex\(providerId, 'movie', category\.id\) \?\? category\.count/);
  assert.match(sqlite, /countKnown:\s*true/);
});

test('Movies SQLite selection does not import Live TV or playback', () => {
  assert.doesNotMatch(model, /LiveTvScreen|UnifiedPlayer|NovaStreamPlayer/);
});