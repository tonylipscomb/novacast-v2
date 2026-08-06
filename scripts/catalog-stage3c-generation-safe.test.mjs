import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  CATALOG_SCHEMA_VERSION,
  STAGE3C_GENERATION_SAFE_MARKER,
  beginCatalogSync,
  catalogItemsTable,
  catalogCategoriesTable,
  clearProviderCatalog,
  completeCatalogSync,
  failCatalogSync,
  getCatalogCategoryCounts,
  getCatalogDatabase,
  getCatalogGenerationPhysicalStats,
  getCatalogItemsPage,
  getCatalogSchemaVersion,
  getCatalogTotalCount,
  initializeCatalogDatabase,
  recoverFragmentedMovieCatalogOnce,
  resetCatalogDatabaseForTests,
  resetMovieFragmentRecoveryForTests,
  resolveReadableCatalogGeneration,
  setCatalogDatabaseOpenerForTests,
  upsertCatalogProvider,
  writeCatalogCategoriesBatch,
  writeCatalogItemsBatch,
} from '../src/features/catalog/index.ts';
import { createNodeSqliteCatalogOpener } from '../src/features/catalog/createNodeSqliteCatalogOpener.ts';

const screen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
const grid = fs.readFileSync('src/features/movies/components/MoviePosterGrid.tsx', 'utf8');

async function setup() {
  await resetCatalogDatabaseForTests();
  resetMovieFragmentRecoveryForTests();
  setCatalogDatabaseOpenerForTests(createNodeSqliteCatalogOpener());
  await initializeCatalogDatabase(':memory:');
}

test.beforeEach(async () => {
  await setup();
});

test.afterEach(async () => {
  await resetCatalogDatabaseForTests();
  resetMovieFragmentRecoveryForTests();
  setCatalogDatabaseOpenerForTests(null);
});

test('Stage 3C schema marker and v2 tables exist', async () => {
  assert.equal(CATALOG_SCHEMA_VERSION, 2);
  assert.equal(await getCatalogSchemaVersion(), 2);
  assert.equal(STAGE3C_GENERATION_SAFE_MARKER, 'stage3c-generation-safe-catalog-v2');
  assert.equal(catalogItemsTable('movie'), 'catalog_items_v2');
  assert.equal(catalogCategoriesTable('movie'), 'catalog_categories_v2');
  // Stage 4.2O.2: Series now shares the generation-safe v2 tables with Movies
  // (previously routed to the legacy, non-generation-scoped tables).
  assert.equal(catalogItemsTable('series'), 'catalog_items_v2');
  assert.equal(catalogCategoriesTable('series'), 'catalog_categories_v2');

  const db = await getCatalogDatabase();
  const tables = await db.getAll(
    `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'catalog_%'`,
  );
  const names = tables.map((row) => row.name);
  assert.ok(names.includes('catalog_items_v2'));
  assert.ok(names.includes('catalog_categories_v2'));
  assert.ok(names.includes('catalog_seasons_v2'));
  assert.ok(names.includes('catalog_items'));
});

test('same content ID may exist in two generations without updating the older row', async () => {
  await upsertCatalogProvider({ providerId: 'p1', providerType: 'xtream', displayName: 'P' });
  const gen1 = await beginCatalogSync('p1', 'movie');
  await writeCatalogCategoriesBatch(
    [{ providerId: 'p1', mediaType: 'movie', categoryId: 'c1', categoryName: 'Action', syncGeneration: gen1 }],
    { mediaType: 'movie' },
  );
  await writeCatalogItemsBatch([
    {
      providerId: 'p1',
      mediaType: 'movie',
      contentId: 'm1',
      categoryId: 'c1',
      title: 'One',
      syncGeneration: gen1,
    },
  ]);
  await completeCatalogSync('p1', 'movie', gen1, { processedCount: 1 });

  const gen2 = await beginCatalogSync('p1', 'movie');
  await writeCatalogCategoriesBatch(
    [{ providerId: 'p1', mediaType: 'movie', categoryId: 'c1', categoryName: 'Action', syncGeneration: gen2 }],
    { mediaType: 'movie' },
  );
  await writeCatalogItemsBatch([
    {
      providerId: 'p1',
      mediaType: 'movie',
      contentId: 'm1',
      categoryId: 'c1',
      title: 'One Updated',
      syncGeneration: gen2,
    },
  ]);

  const db = await getCatalogDatabase();
  const rows = await db.getAll(
    `SELECT sync_generation, title FROM catalog_items_v2
     WHERE provider_id='p1' AND content_id='m1'
     ORDER BY sync_generation ASC`,
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, 'One');
  assert.equal(rows[1].title, 'One Updated');

  const previous = await getCatalogGenerationPhysicalStats('p1', 'movie', gen1);
  assert.equal(previous.itemRows, 1);
});

test('writing generation N does not alter generation P', async () => {
  await upsertCatalogProvider({ providerId: 'p1', providerType: 'xtream', displayName: 'P' });
  const genP = await beginCatalogSync('p1', 'movie');
  await writeCatalogCategoriesBatch(
    [{ providerId: 'p1', mediaType: 'movie', categoryId: 'c1', categoryName: 'Drama', syncGeneration: genP }],
    { mediaType: 'movie' },
  );
  await writeCatalogItemsBatch([
    { providerId: 'p1', mediaType: 'movie', contentId: 'a', categoryId: 'c1', title: 'A', syncGeneration: genP },
    { providerId: 'p1', mediaType: 'movie', contentId: 'b', categoryId: 'c1', title: 'B', syncGeneration: genP },
  ]);
  await completeCatalogSync('p1', 'movie', genP, { processedCount: 2 });

  const genN = await beginCatalogSync('p1', 'movie');
  await writeCatalogItemsBatch([
    { providerId: 'p1', mediaType: 'movie', contentId: 'c', categoryId: 'c1', title: 'C', syncGeneration: genN },
  ]);

  const statsP = await getCatalogGenerationPhysicalStats('p1', 'movie', genP);
  assert.equal(statsP.itemRows, 2);
  assert.equal(statsP.categoryRows, 1);
  const statsN = await getCatalogGenerationPhysicalStats('p1', 'movie', genN);
  assert.equal(statsN.itemRows, 1);
});

test('failed generation deletion does not affect completed generation', async () => {
  await upsertCatalogProvider({ providerId: 'p1', providerType: 'xtream', displayName: 'P' });
  const ready = await beginCatalogSync('p1', 'movie');
  await writeCatalogCategoriesBatch(
    [{ providerId: 'p1', mediaType: 'movie', categoryId: 'c1', categoryName: 'X', syncGeneration: ready }],
    { mediaType: 'movie' },
  );
  await writeCatalogItemsBatch([
    { providerId: 'p1', mediaType: 'movie', contentId: 'm1', categoryId: 'c1', title: 'M', syncGeneration: ready },
  ]);
  await completeCatalogSync('p1', 'movie', ready, { processedCount: 1 });

  const failed = await beginCatalogSync('p1', 'movie');
  await writeCatalogItemsBatch([
    { providerId: 'p1', mediaType: 'movie', contentId: 'tmp', categoryId: 'c1', title: 'T', syncGeneration: failed },
  ]);
  await failCatalogSync('p1', 'movie', 'sync_failed');

  const stillReady = await getCatalogGenerationPhysicalStats('p1', 'movie', ready);
  assert.equal(stillReady.itemRows, 1);
  assert.equal(await resolveReadableCatalogGeneration('p1', 'movie'), ready);
});

test('category metadata remains generation-scoped', async () => {
  await upsertCatalogProvider({ providerId: 'p1', providerType: 'xtream', displayName: 'P' });
  const g1 = await beginCatalogSync('p1', 'movie');
  await writeCatalogCategoriesBatch(
    [{ providerId: 'p1', mediaType: 'movie', categoryId: 'c1', categoryName: 'Old', syncGeneration: g1 }],
    { mediaType: 'movie' },
  );
  await writeCatalogItemsBatch([
    { providerId: 'p1', mediaType: 'movie', contentId: 'm1', categoryId: 'c1', title: 'M', syncGeneration: g1 },
  ]);
  await completeCatalogSync('p1', 'movie', g1, { processedCount: 1 });

  const g2 = await beginCatalogSync('p1', 'movie');
  await writeCatalogCategoriesBatch(
    [{ providerId: 'p1', mediaType: 'movie', categoryId: 'c1', categoryName: 'New', syncGeneration: g2 }],
    { mediaType: 'movie' },
  );

  const db = await getCatalogDatabase();
  const names = await db.getAll(
    `SELECT sync_generation, category_name FROM catalog_categories_v2
     WHERE provider_id='p1' AND category_id='c1' ORDER BY sync_generation`,
  );
  assert.equal(names.length, 2);
  assert.equal(names[0].category_name, 'Old');
  assert.equal(names[1].category_name, 'New');
});

test('All Movies count is independent of category joins', async () => {
  await upsertCatalogProvider({ providerId: 'p1', providerType: 'xtream', displayName: 'P' });
  const generation = await beginCatalogSync('p1', 'movie');
  await writeCatalogCategoriesBatch(
    [{ providerId: 'p1', mediaType: 'movie', categoryId: 'c1', categoryName: 'A', syncGeneration: generation }],
    { mediaType: 'movie' },
  );
  await writeCatalogItemsBatch([
    { providerId: 'p1', mediaType: 'movie', contentId: '1', categoryId: 'c1', title: 'One', syncGeneration: generation },
    { providerId: 'p1', mediaType: 'movie', contentId: '2', categoryId: null, title: 'Two', syncGeneration: generation },
  ]);
  await completeCatalogSync('p1', 'movie', generation, { processedCount: 2 });

  const total = await getCatalogTotalCount('p1', 'movie', { generation });
  assert.equal(total, 2);
});

test('recovery deduplicates content IDs deterministically and excludes failed gens', async () => {
  await upsertCatalogProvider({ providerId: 'p1', providerType: 'xtream', displayName: 'P' });
  const db = await getCatalogDatabase();

  // Legacy PK is content-unique, so ONN fragments are disjoint content_id sets
  // stamped with different sync_generation values (not overlapping rows).
  const legacySeeds = [
    [36, ['a', 'b'], 'G36', 'cat-1'],
    [39, ['c'], 'G39', 'cat-2'],
    [43, ['d', 'e'], 'G43', 'cat-3'],
    [44, ['f', 'g'], 'G44', 'cat-4'],
    [48, ['ghost'], 'G48', 'cat-5'],
    [49, ['current'], 'G49', 'cat-6'],
  ];
  for (const [generation, ids, titlePrefix, categoryId] of legacySeeds) {
    for (const id of ids) {
      await db.run(
        `INSERT INTO catalog_items (
          provider_id, media_type, content_id, category_id, title, normalized_title,
          sync_generation, updated_at
        ) VALUES (?, 'movie', ?, ?, ?, ?, ?, ?)`,
        [
          'p1',
          id,
          categoryId,
          `${titlePrefix}-${id}`,
          `${titlePrefix}-${id}`.toLowerCase(),
          generation,
          Date.now(),
        ],
      );
    }
  }
  // Extra nonempty provider categories for the >=5 acceptance check.
  await db.run(
    `UPDATE catalog_items SET category_id='cat-5' WHERE content_id='g'`,
  );

  // 439 category metadata rows on generation 36.
  for (let i = 1; i <= 439; i += 1) {
    await db.run(
      `INSERT INTO catalog_categories (
        provider_id, media_type, category_id, category_name, sort_order, item_count, sync_generation, updated_at
      ) VALUES (?, 'movie', ?, ?, ?, 0, 36, ?)`,
      ['p1', `cat-${i}`, `Category ${i}`, i, Date.now()],
    );
  }

  const result = await recoverFragmentedMovieCatalogOnce('p1');
  assert.equal(result.validationPassed, true, result.skippedReason ?? 'validation');
  assert.equal(result.activated, true);
  assert.deepEqual(result.sourceGenerations, [44, 43, 39, 36]);
  assert.equal(result.duplicateCount, 0);
  assert.equal(result.recoveredRows, 7); // a..g, excluding ghost/current
  assert.equal(result.recoveredCategoryRows, 439);
  assert.ok(!result.sourceGenerations.includes(48));
  assert.ok(!result.sourceGenerations.includes(49));

  const readable = await resolveReadableCatalogGeneration('p1', 'movie');
  assert.equal(readable, result.recoveredGeneration);
  const categories = await getCatalogCategoryCounts('p1', 'movie', { generation: readable });
  assert.ok(categories.length >= 5);

  const page = await getCatalogItemsPage({
    providerId: 'p1',
    mediaType: 'movie',
    generation: readable,
    query: 'g44-f',
    limit: 5,
  });
  assert.equal(page.items[0]?.title, 'G44-f');
});

test('recovery dedup SQL prefers the highest source generation when overlaps exist', async () => {
  // Prove the deterministic MAX(sync_generation) preference using a temp table
  // that allows overlapping content IDs (legacy PK cannot).
  const db = await getCatalogDatabase();
  await db.exec(`
    CREATE TABLE legacy_overlap_items (
      content_id TEXT NOT NULL,
      sync_generation INTEGER NOT NULL,
      title TEXT NOT NULL,
      PRIMARY KEY (content_id, sync_generation)
    );
  `);
  await db.run(`INSERT INTO legacy_overlap_items VALUES ('e', 43, 'G43-e')`);
  await db.run(`INSERT INTO legacy_overlap_items VALUES ('e', 44, 'G44-e')`);
  await db.run(`INSERT INTO legacy_overlap_items VALUES ('f', 44, 'G44-f')`);
  const preferred = await db.getAll(
    `SELECT i.content_id, i.title
     FROM legacy_overlap_items i
     INNER JOIN (
       SELECT content_id, MAX(sync_generation) AS max_generation
       FROM legacy_overlap_items
       GROUP BY content_id
     ) best
       ON best.content_id = i.content_id
      AND best.max_generation = i.sync_generation
     ORDER BY i.content_id`,
  );
  assert.deepEqual(
    preferred.map((row) => row.title),
    ['G44-e', 'G44-f'],
  );
});

test('ghost generation with zero rows cannot become readable', async () => {
  await upsertCatalogProvider({ providerId: 'p1', providerType: 'xtream', displayName: 'P' });
  const db = await getCatalogDatabase();
  await db.run(
    `INSERT INTO catalog_sync_state (
      provider_id, media_type, status, phase, processed_count, total_count, generation, started_at, completed_at, error_code
    ) VALUES ('p1', 'movie', 'error', 'complete', 0, 0, 48, ?, ?, 'boom')`,
    [Date.now(), Date.now()],
  );
  await db.run(
    `UPDATE catalog_providers SET catalog_generation = 48, sync_status = 'error' WHERE provider_id = 'p1'`,
  );

  // Seed a physically valid older generation in v2.
  await writeCatalogCategoriesBatch(
    [{ providerId: 'p1', mediaType: 'movie', categoryId: 'c1', categoryName: 'A', syncGeneration: 36 }],
    { mediaType: 'movie' },
  );
  await writeCatalogItemsBatch([
    { providerId: 'p1', mediaType: 'movie', contentId: 'm1', categoryId: 'c1', title: 'M', syncGeneration: 36 },
  ]);

  const resolved = await resolveReadableCatalogGeneration('p1', 'movie');
  assert.equal(resolved, 36);
});

test('catalog_generation updates only after physical validation', async () => {
  await upsertCatalogProvider({ providerId: 'p1', providerType: 'xtream', displayName: 'P' });
  const generation = await beginCatalogSync('p1', 'movie');
  // No items / categories written.
  await completeCatalogSync('p1', 'movie', generation, { processedCount: 0 });

  const db = await getCatalogDatabase();
  const provider = await db.getFirst(`SELECT catalog_generation, sync_status FROM catalog_providers WHERE provider_id='p1'`);
  assert.equal(asNumber(provider.catalog_generation), 0);
  const state = await db.getFirst(
    `SELECT status, error_code FROM catalog_sync_state WHERE provider_id='p1' AND media_type='movie'`,
  );
  assert.equal(state.status, 'error');
  assert.equal(state.error_code, 'complete_validation_failed');
});

test('previous generation remains readable throughout sync', async () => {
  await upsertCatalogProvider({ providerId: 'p1', providerType: 'xtream', displayName: 'P' });
  const ready = await beginCatalogSync('p1', 'movie');
  await writeCatalogCategoriesBatch(
    [{ providerId: 'p1', mediaType: 'movie', categoryId: 'c1', categoryName: 'A', syncGeneration: ready }],
    { mediaType: 'movie' },
  );
  await writeCatalogItemsBatch([
    { providerId: 'p1', mediaType: 'movie', contentId: 'm1', categoryId: 'c1', title: 'Ready', syncGeneration: ready },
  ]);
  await completeCatalogSync('p1', 'movie', ready, { processedCount: 1 });

  const next = await beginCatalogSync('p1', 'movie');
  assert.notEqual(next, ready);
  assert.equal(await resolveReadableCatalogGeneration('p1', 'movie'), ready);
  const page = await getCatalogItemsPage({
    providerId: 'p1',
    mediaType: 'movie',
    generation: ready,
    limit: 10,
  });
  assert.equal(page.totalCount, 1);
});

test('Stage 3C catalog work remains separate from Movies focus coordinator', () => {
  // Stage 3D owns close focus; Stage 3C must not reintroduce a global focus owner.
  assert.match(screen, /restore-exact-poster-after-detail-close/);
  assert.match(grid, /scrollToOffset/);
  assert.doesNotMatch(screen, /MoviesFocusOwner|deriveMoviesFocusOwner/);
  assert.doesNotMatch(grid, /MoviesFocusOwner/);
});

function asNumber(value) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}
