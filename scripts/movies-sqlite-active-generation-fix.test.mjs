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

test('syncing or failed media resolves through the readable-generation guard', () => {
  assert.match(repository, /export async function resolveReadableCatalogGeneration/);
  assert.match(repository, /currentAttemptGeneration/);
  assert.match(repository, /lastCompletedGeneration/);
  assert.match(repository, /previous-during-sync/);
  assert.match(repository, /previous-after-failure/);
  assert.match(repository, /recovered-completed-generation/);
});

test('category counts are derived from readable item rows', () => {
  assert.match(repository, /LEFT JOIN catalog_items i/);
  assert.match(repository, /HAVING COUNT\(i\.content_id\) > 0/);
});

test('SQLite Movies readiness accepts a readable prior generation', () => {
  assert.match(movies, /resolveReadableCatalogGeneration\(providerId, 'movie'\)/);
  assert.match(movies, /generation,\s*\}/s);
  assert.match(movies, /return totalCount > 0/);
});
