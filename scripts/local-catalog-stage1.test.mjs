import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CATALOG_REQUIRED_INDEXES,
  CATALOG_REQUIRED_TABLES,
  CATALOG_SCHEMA_VERSION,
  beginCatalogSync,
  clearProviderCatalog,
  completeCatalogSync,
  failCatalogSync,
  getCatalogCategoryCounts,
  getCatalogDatabase,
  getCatalogItemsPage,
  getCatalogSchemaVersion,
  getCatalogSyncState,
  getCatalogTotalCount,
  initializeCatalogDatabase,
  listCatalogItemsForGeneration,
  normalizeCatalogTitle,
  resetCatalogDatabaseForTests,
  setCatalogDatabaseOpenerForTests,
  upsertCatalogProvider,
  writeCatalogCategoriesBatch,
  writeCatalogItemsBatch,
  writeCatalogSeasonsBatch,
} from '../src/features/catalog/index.ts';
import { createNodeSqliteCatalogOpener } from '../src/features/catalog/createNodeSqliteCatalogOpener.ts';

async function setupMemoryCatalog() {
  await resetCatalogDatabaseForTests();
  setCatalogDatabaseOpenerForTests(createNodeSqliteCatalogOpener());
  await initializeCatalogDatabase(':memory:');
}

test.beforeEach(async () => {
  await setupMemoryCatalog();
});

test.afterEach(async () => {
  await resetCatalogDatabaseForTests();
  setCatalogDatabaseOpenerForTests(null);
});

test('migrations are idempotent and bump schema version', async () => {
  assert.equal(await getCatalogSchemaVersion(), CATALOG_SCHEMA_VERSION);
  const db = await getCatalogDatabase();
  await db.exec(`PRAGMA user_version = ${CATALOG_SCHEMA_VERSION}`);
  // Re-init / remigrate should not throw and should keep version.
  const { migrateCatalogDatabase } = await import('../src/features/catalog/catalogDatabase.ts');
  const version = await migrateCatalogDatabase(db);
  assert.equal(version, CATALOG_SCHEMA_VERSION);
});

test('schema tables and required indexes exist', async () => {
  const db = await getCatalogDatabase();
  const tables = await db.getAll(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'catalog_%' ORDER BY name`,
  );
  const tableNames = tables.map((row) => row.name);
  for (const name of CATALOG_REQUIRED_TABLES) {
    assert.ok(tableNames.includes(name), `missing table ${name}`);
  }

  const indexes = await db.getAll(
    `SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_catalog_%' ORDER BY name`,
  );
  const indexNames = indexes.map((row) => row.name);
  for (const name of CATALOG_REQUIRED_INDEXES) {
    assert.ok(indexNames.includes(name), `missing index ${name}`);
  }
});

test('batch writes persist categories, items, and seasons', async () => {
  await upsertCatalogProvider({ providerId: 'p1', providerType: 'xtream', displayName: 'One' });
  const generation = await beginCatalogSync('p1', 'series', { phase: 'full' });

  await writeCatalogCategoriesBatch([
    {
      providerId: 'p1',
      mediaType: 'series',
      categoryId: 'drama',
      categoryName: 'Drama',
      sortOrder: 1,
      syncGeneration: generation,
    },
  ]);
  await writeCatalogItemsBatch([
    {
      providerId: 'p1',
      mediaType: 'series',
      contentId: 'ep1',
      categoryId: 'drama',
      title: 'Pilot',
      seriesId: 'show1',
      seasonNumber: 1,
      episodeNumber: 1,
      syncGeneration: generation,
    },
  ]);
  await writeCatalogSeasonsBatch([
    {
      providerId: 'p1',
      seriesId: 'show1',
      seasonNumber: 1,
      title: 'Season 1',
      episodeCount: 1,
      syncGeneration: generation,
    },
  ]);

  await completeCatalogSync('p1', 'series', generation, { processedCount: 1 });

  const items = await listCatalogItemsForGeneration('p1', 'series', generation);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Pilot');
  assert.equal(normalizeCatalogTitle('  Pilot Episode '), 'pilot episode');
});

test('failed sync keeps previous successful generation', async () => {
  await upsertCatalogProvider({ providerId: 'p1', providerType: 'xtream' });
  const g1 = await beginCatalogSync('p1', 'movie');
  await writeCatalogCategoriesBatch([
    {
      providerId: 'p1',
      mediaType: 'movie',
      categoryId: 'action',
      categoryName: 'Action',
      syncGeneration: g1,
    },
  ]);
  await writeCatalogItemsBatch([
    {
      providerId: 'p1',
      mediaType: 'movie',
      contentId: 'm1',
      categoryId: 'action',
      title: 'Kept Movie',
      syncGeneration: g1,
    },
  ]);
  await completeCatalogSync('p1', 'movie', g1);

  const g2 = await beginCatalogSync('p1', 'movie');
  await writeCatalogItemsBatch([
    {
      providerId: 'p1',
      mediaType: 'movie',
      contentId: 'm2',
      categoryId: 'action',
      title: 'Failed Draft',
      syncGeneration: g2,
    },
  ]);
  await failCatalogSync('p1', 'movie', 'network_error');

  const state = await getCatalogSyncState('p1', 'movie');
  assert.equal(state?.status, 'error');
  assert.equal(state?.errorCode, 'network_error');

  const page = await getCatalogItemsPage({ providerId: 'p1', mediaType: 'movie' });
  assert.equal(page.totalCount, 1);
  assert.equal(page.items[0].contentId, 'm1');
  assert.equal(page.items[0].title, 'Kept Movie');

  // Failed generation draft still exists on disk until a later successful sync prunes it.
  const draft = await listCatalogItemsForGeneration('p1', 'movie', g2);
  assert.equal(draft.length, 1);
});

test('successful sync removes stale generation', async () => {
  await upsertCatalogProvider({ providerId: 'p1', providerType: 'xtream' });
  const g1 = await beginCatalogSync('p1', 'movie');
  await writeCatalogItemsBatch([
    {
      providerId: 'p1',
      mediaType: 'movie',
      contentId: 'old',
      categoryId: 'a',
      title: 'Old',
      syncGeneration: g1,
    },
  ]);
  await writeCatalogCategoriesBatch([
    {
      providerId: 'p1',
      mediaType: 'movie',
      categoryId: 'a',
      categoryName: 'A',
      syncGeneration: g1,
    },
  ]);
  await completeCatalogSync('p1', 'movie', g1);

  const g2 = await beginCatalogSync('p1', 'movie');
  await writeCatalogCategoriesBatch([
    {
      providerId: 'p1',
      mediaType: 'movie',
      categoryId: 'a',
      categoryName: 'A',
      syncGeneration: g2,
    },
  ]);
  await writeCatalogItemsBatch([
    {
      providerId: 'p1',
      mediaType: 'movie',
      contentId: 'new',
      categoryId: 'a',
      title: 'New',
      syncGeneration: g2,
    },
  ]);
  await completeCatalogSync('p1', 'movie', g2);

  assert.equal((await listCatalogItemsForGeneration('p1', 'movie', g1)).length, 0);
  assert.equal((await listCatalogItemsForGeneration('p1', 'movie', g2)).length, 1);
  const page = await getCatalogItemsPage({ providerId: 'p1', mediaType: 'movie' });
  assert.equal(page.items[0].contentId, 'new');
});

test('category counts are computed from active generation items', async () => {
  await upsertCatalogProvider({ providerId: 'p1', providerType: 'xtream' });
  const generation = await beginCatalogSync('p1', 'movie');
  await writeCatalogCategoriesBatch([
    {
      providerId: 'p1',
      mediaType: 'movie',
      categoryId: 'action',
      categoryName: 'Action',
      sortOrder: 0,
      syncGeneration: generation,
    },
    {
      providerId: 'p1',
      mediaType: 'movie',
      categoryId: 'comedy',
      categoryName: 'Comedy',
      sortOrder: 1,
      syncGeneration: generation,
    },
  ]);
  await writeCatalogItemsBatch([
    {
      providerId: 'p1',
      mediaType: 'movie',
      contentId: '1',
      categoryId: 'action',
      title: 'A1',
      syncGeneration: generation,
    },
    {
      providerId: 'p1',
      mediaType: 'movie',
      contentId: '2',
      categoryId: 'action',
      title: 'A2',
      syncGeneration: generation,
    },
    {
      providerId: 'p1',
      mediaType: 'movie',
      contentId: '3',
      categoryId: 'comedy',
      title: 'C1',
      syncGeneration: generation,
    },
  ]);
  await completeCatalogSync('p1', 'movie', generation);

  const counts = await getCatalogCategoryCounts('p1', 'movie');
  assert.deepEqual(
    counts.map((row) => `${row.categoryId}:${row.itemCount}`),
    ['action:2', 'comedy:1'],
  );
});

test('pagination returns stable pages', async () => {
  await upsertCatalogProvider({ providerId: 'p1', providerType: 'xtream' });
  const generation = await beginCatalogSync('p1', 'movie');
  await writeCatalogCategoriesBatch([
    {
      providerId: 'p1',
      mediaType: 'movie',
      categoryId: 'all',
      categoryName: 'All',
      syncGeneration: generation,
    },
  ]);
  const items = Array.from({ length: 10 }, (_, index) => ({
    providerId: 'p1',
    mediaType: 'movie',
    contentId: `id-${String(index).padStart(2, '0')}`,
    categoryId: 'all',
    title: `Title ${String.fromCharCode(65 + index)}`,
    syncGeneration: generation,
  }));
  await writeCatalogItemsBatch(items);
  await completeCatalogSync('p1', 'movie', generation);

  const page1 = await getCatalogItemsPage({
    providerId: 'p1',
    mediaType: 'movie',
    categoryId: 'all',
    limit: 4,
    offset: 0,
    sort: 'title',
  });
  const page2 = await getCatalogItemsPage({
    providerId: 'p1',
    mediaType: 'movie',
    categoryId: 'all',
    limit: 4,
    offset: 4,
    sort: 'title',
  });

  assert.equal(page1.items.length, 4);
  assert.equal(page2.items.length, 4);
  assert.equal(page1.totalCount, 10);
  assert.equal(page1.hasMore, true);
  assert.equal(page2.hasMore, true);
  assert.notEqual(page1.items[0].contentId, page2.items[0].contentId);
  assert.deepEqual(
    [...page1.items, ...page2.items].map((item) => item.contentId),
    ['id-00', 'id-01', 'id-02', 'id-03', 'id-04', 'id-05', 'id-06', 'id-07'],
  );
});

test('local search is case-insensitive via normalized_title', async () => {
  await upsertCatalogProvider({ providerId: 'p1', providerType: 'xtream' });
  const generation = await beginCatalogSync('p1', 'movie');
  await writeCatalogItemsBatch([
    {
      providerId: 'p1',
      mediaType: 'movie',
      contentId: '1',
      categoryId: 'a',
      title: 'The Matrix Reloaded',
      syncGeneration: generation,
    },
    {
      providerId: 'p1',
      mediaType: 'movie',
      contentId: '2',
      categoryId: 'a',
      title: 'Inception',
      syncGeneration: generation,
    },
  ]);
  await writeCatalogCategoriesBatch([
    {
      providerId: 'p1',
      mediaType: 'movie',
      categoryId: 'a',
      categoryName: 'A',
      syncGeneration: generation,
    },
  ]);
  await completeCatalogSync('p1', 'movie', generation);

  const page = await getCatalogItemsPage({
    providerId: 'p1',
    mediaType: 'movie',
    query: 'matrix',
  });
  assert.equal(page.totalCount, 1);
  assert.equal(page.items[0].contentId, '1');
  assert.equal(await getCatalogTotalCount('p1', 'movie', { query: 'MATRIX' }), 1);
});

test('provider catalogs remain isolated and clearProviderCatalog is scoped', async () => {
  await upsertCatalogProvider({ providerId: 'alpha', providerType: 'xtream' });
  await upsertCatalogProvider({ providerId: 'beta', providerType: 'xtream' });

  const gAlpha = await beginCatalogSync('alpha', 'movie');
  await writeCatalogItemsBatch([
    {
      providerId: 'alpha',
      mediaType: 'movie',
      contentId: 'a1',
      categoryId: 'x',
      title: 'Alpha One',
      syncGeneration: gAlpha,
    },
  ]);
  await writeCatalogCategoriesBatch([
    {
      providerId: 'alpha',
      mediaType: 'movie',
      categoryId: 'x',
      categoryName: 'X',
      syncGeneration: gAlpha,
    },
  ]);
  await completeCatalogSync('alpha', 'movie', gAlpha);

  const gBeta = await beginCatalogSync('beta', 'movie');
  await writeCatalogItemsBatch([
    {
      providerId: 'beta',
      mediaType: 'movie',
      contentId: 'b1',
      categoryId: 'y',
      title: 'Beta One',
      syncGeneration: gBeta,
    },
  ]);
  await writeCatalogCategoriesBatch([
    {
      providerId: 'beta',
      mediaType: 'movie',
      categoryId: 'y',
      categoryName: 'Y',
      syncGeneration: gBeta,
    },
  ]);
  await completeCatalogSync('beta', 'movie', gBeta);

  await clearProviderCatalog('alpha');

  assert.equal((await getCatalogItemsPage({ providerId: 'alpha', mediaType: 'movie' })).totalCount, 0);
  assert.equal((await getCatalogItemsPage({ providerId: 'beta', mediaType: 'movie' })).totalCount, 1);
  assert.equal((await getCatalogItemsPage({ providerId: 'beta', mediaType: 'movie' })).items[0].title, 'Beta One');
});

test('file-backed catalog initializes once and survives reopen helper reset with path', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'novacast-catalog-'));
  const dbPath = path.join(dir, 'stage1.db');
  await resetCatalogDatabaseForTests();
  setCatalogDatabaseOpenerForTests(createNodeSqliteCatalogOpener());
  await initializeCatalogDatabase(dbPath);
  await upsertCatalogProvider({ providerId: 'p-file', providerType: 'xtream' });
  const generation = await beginCatalogSync('p-file', 'movie');
  await writeCatalogItemsBatch([
    {
      providerId: 'p-file',
      mediaType: 'movie',
      contentId: 'f1',
      categoryId: 'c',
      title: 'File Movie',
      syncGeneration: generation,
    },
  ]);
  await writeCatalogCategoriesBatch([
    {
      providerId: 'p-file',
      mediaType: 'movie',
      categoryId: 'c',
      categoryName: 'C',
      syncGeneration: generation,
    },
  ]);
  await completeCatalogSync('p-file', 'movie', generation);
  await resetCatalogDatabaseForTests();

  setCatalogDatabaseOpenerForTests(createNodeSqliteCatalogOpener());
  await initializeCatalogDatabase(dbPath);
  const page = await getCatalogItemsPage({ providerId: 'p-file', mediaType: 'movie' });
  assert.equal(page.totalCount, 1);
  assert.equal(page.items[0].title, 'File Movie');
  await resetCatalogDatabaseForTests();
  await fs.rm(dir, { recursive: true, force: true });
});
