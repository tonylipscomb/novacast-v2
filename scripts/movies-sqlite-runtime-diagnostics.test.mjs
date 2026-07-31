import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const repository = fs.readFileSync(
  new URL('../src/features/catalog/catalogRepository.ts', import.meta.url),
  'utf8',
);
const movies = fs.readFileSync(
  new URL('../src/features/movies/data/SqliteMovieDataSource.ts', import.meta.url),
  'utf8',
);

test('catalog repository exposes a provider and generation contract snapshot', () => {
  assert.match(repository, /getCatalogDiagnosticSnapshot/);
  assert.match(repository, /itemGenerationCounts/);
  assert.match(repository, /allItemContracts/);
  assert.match(repository, /resolvedGeneration/);
});

test('SQLite Movies logs diagnostics only behind an environment flag', () => {
  assert.match(movies, /EXPO_PUBLIC_MOVIES_SQLITE_DIAGNOSTICS/);
  assert.match(movies, /\[Movies SQLite Diagnostic\]/);
  assert.match(movies, /get-categories-before-query/);
  assert.match(movies, /first-page-after-query/);
  assert.match(repository, /\[Movies SQLite Query Diagnostic\]/);
  assert.match(repository, /firstFiveMovieIds/);
  assert.match(repository, /sqlRowCount/);
});
