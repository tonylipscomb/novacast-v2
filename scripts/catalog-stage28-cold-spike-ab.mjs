/**
 * Stage 2.8 Phase B — local A/B for cold category-write spike.
 * Runs in Node (node:sqlite). Not a substitute for ONN, but isolates
 * first-use vs volume vs diagnostics shape.
 */
import assert from 'node:assert/strict';
import {
  beginCatalogSync,
  initializeCatalogDatabase,
  processStreamingBatches,
  resetCatalogDatabaseForTests,
  setCatalogDatabaseOpenerForTests,
  upsertCatalogProvider,
  writeCatalogCategoriesBatch,
} from '../src/features/catalog/index.ts';
import { createNodeSqliteCatalogOpener } from '../src/features/catalog/createNodeSqliteCatalogOpener.ts';
import {
  resetColdCategorySpikeAuditForTests,
  summarizeColdSpikeForTests,
} from '../src/features/catalog/coldCategorySpikeAudit.ts';

process.env.EXPO_PUBLIC_NOVACAST_CATALOG_AUDIT = '1';

function now() {
  return performance.now();
}

function makeCategories(n, generation) {
  return Array.from({ length: n }, (_, i) => ({
    providerId: 'bench',
    mediaType: 'movie',
    categoryId: `c-${i}`,
    categoryName: `Category ${i}`,
    sortOrder: i,
    syncGeneration: generation,
  }));
}

async function setupDb(path = ':memory:') {
  await resetCatalogDatabaseForTests();
  resetColdCategorySpikeAuditForTests();
  setCatalogDatabaseOpenerForTests(createNodeSqliteCatalogOpener());
  await initializeCatalogDatabase(path);
  await upsertCatalogProvider({ providerId: 'bench', providerType: 'xtream' });
  return beginCatalogSync('bench', 'movie', { phase: 'categories' });
}

async function streamWrite(categories, label) {
  const start = now();
  let written = 0;
  let maxChunk = 0;
  const timing = await processStreamingBatches(
    categories,
    (c) => c,
    async (batch) => {
      written += await writeCatalogCategoriesBatch(batch, { mediaType: 'movie' });
    },
    {
      kind: 'categories',
      writeKind: 'categories',
      minItems: 4,
      maxItems: 12,
      onChunk: ({ chunkMs }) => {
        maxChunk = Math.max(maxChunk, chunkMs);
      },
    },
  );
  return {
    label,
    written,
    totalMs: Math.round(now() - start),
    maxChunkMs: Math.round(Math.max(maxChunk, timing.maxChunkMs)),
    chunks: timing.chunks,
    summary: summarizeColdSpikeForTests(),
  };
}

async function prewarm() {
  const db = await (await import('../src/features/catalog/index.ts')).getCatalogDatabase();
  const start = now();
  const stmt = await db.prepare('SELECT 1 AS ok');
  try {
    await stmt.execute([]);
  } finally {
    await stmt.finalize();
  }
  await (await import('../src/features/catalog/index.ts')).withCatalogTransaction(async () => {
    // no-op txn warm
  });
  return Math.round(now() - start);
}

const results = [];

// A: prewarm then 439
{
  const generation = await setupDb();
  const warmMs = await prewarm();
  resetColdCategorySpikeAuditForTests();
  const cats = makeCategories(439, generation);
  const result = await streamWrite(cats, 'A_prewarm_then_439');
  results.push({ ...result, warmMs });
}

// B: 10 then remainder
{
  const generation = await setupDb();
  const cats = makeCategories(439, generation);
  const first = await streamWrite(cats.slice(0, 10), 'B_first_10');
  await new Promise((r) => setTimeout(r, 0));
  resetColdCategorySpikeAuditForTests();
  // Force batch index restart awareness — remaining write continues as warm-ish
  const rest = await streamWrite(cats.slice(10), 'B_remaining_429');
  results.push({ first10: first, remaining: rest });
}

// C: 439 with audit still on (diagnostics path)
{
  const generation = await setupDb();
  const cats = makeCategories(439, generation);
  results.push(await streamWrite(cats, 'C_439_audit_on'));
}

// D: prewarm + 439 synthetic (same as A but labeled)
{
  const generation = await setupDb();
  await prewarm();
  resetColdCategorySpikeAuditForTests();
  results.push(await streamWrite(makeCategories(439, generation), 'D_warm_synthetic_439'));
}

console.log(JSON.stringify(results, null, 2));
assert.ok(results.length >= 4);
