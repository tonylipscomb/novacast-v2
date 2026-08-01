import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const screen = await fs.readFile(new URL('../src/features/movies/MoviesScreen.tsx', import.meta.url), 'utf8');
const category = await fs.readFile(new URL('../src/features/movies/components/MovieCategoryRail.tsx', import.meta.url), 'utf8');
const shell = await fs.readFile(new URL('../src/components/nova/NovaTvShell.tsx', import.meta.url), 'utf8');
const repository = await fs.readFile(new URL('../src/features/catalog/catalogRepository.ts', import.meta.url), 'utf8');
const sqlite = await fs.readFile(new URL('../src/features/movies/data/SqliteMovieDataSource.ts', import.meta.url), 'utf8');
const model = await fs.readFile(new URL('../src/features/movies/useMoviesScreenModel.ts', import.meta.url), 'utf8');
const detail = await fs.readFile(new URL('../src/components/media/MediaDetailOverlay.tsx', import.meta.url), 'utf8');

test('close sentinel holds focus until exact poster confirmation', () => {
  assert.match(screen, /detailCloseSentinelActive/);
  assert.match(screen, /detailCloseSentinelRef\.current\?\.focus\(\)/);
  assert.match(screen, /phase: 'target-requested'/);
  assert.match(screen, /phase: 'target-confirmed'/);
  assert.match(screen, /phase: 'released'/);
  assert.match(screen, /phase: 'timeout'/);
  assert.match(screen, /requestedMovieId: restore\.targetMovieId/);
  assert.match(screen, /actuallyFocusedMovieId: movie\.id/);
});

test('navbar and categories are temporarily non-focusable during sentinel hold', () => {
  assert.match(screen, /navigationFocusable=\{!detailCloseSentinelActive\}/);
  assert.match(screen, /focusable=\{!detailCloseSentinelActive\}/);
  assert.match(shell, /hasTVPreferredFocus=\{navbarPreferredFocus && active\}/);
  assert.match(category, /focusable=\{focusable\}/);
});

test('category reads use explicit readable generation and preserve empty refreshes', () => {
  assert.match(repository, /options\?\.generation/);
  assert.match(repository, /state\?\.status === 'syncing' \|\| state\?\.status === 'error'/);
  // Stage 3C.1 Movies: grouped v2 counts; Series still uses LEFT JOIN metadata path.
  assert.match(repository, /GROUP BY category_id/);
  assert.match(repository, /LEFT JOIN \$\{itemsTable\} i/);
  assert.match(sqlite, /resolveReadableCatalogGeneration\(providerId, 'movie'\)/);
  assert.match(sqlite, /getCatalogCategoryCounts\(providerId, 'movie', \{ generation: readableGeneration \}\)/);
  assert.match(sqlite, /rejected-empty-refresh|preservedPreviousCounts: true/);
  assert.match(model, /if \(!next\.length && previous\.length\)/);
  assert.match(model, /empty-refresh-preserved/);
});

test('detail hook audit remains before conditional returns', () => {
  const auditIndex = detail.indexOf("component: 'MediaDetailOverlay.TVFocusGuideView'");
  const nullReturnIndex = detail.indexOf('if (!detail)');
  assert.ok(auditIndex >= 0 && auditIndex < nullReturnIndex);
});
