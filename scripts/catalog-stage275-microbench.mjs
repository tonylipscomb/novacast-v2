/**
 * Local Stage 2.75 microbench: old-style full-map+write vs streaming pipeline.
 * Uses node:sqlite — not a substitute for ONN, but quantifies JS allocation/shape.
 */
import assert from 'node:assert/strict';
import {
  beginCatalogSync,
  initializeCatalogDatabase,
  processStreamingBatches,
  processTimeBudgeted,
  resetCatalogDatabaseForTests,
  setCatalogDatabaseOpenerForTests,
  upsertCatalogProvider,
  writeCatalogItemsBatch,
} from '../src/features/catalog/index.ts';
import { createNodeSqliteCatalogOpener } from '../src/features/catalog/createNodeSqliteCatalogOpener.ts';

function now() {
  return performance.now();
}

function makeItems(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `id-${i}`,
    title: `Title ${i} Adventure`,
    categoryId: '126',
    posterUrl: `https://example.com/${i}.jpg`,
    rating: '7.5',
    description: 'x'.repeat(40),
  }));
}

function mapItem(item, providerId, generation) {
  return {
    providerId,
    mediaType: 'movie',
    contentId: item.id,
    categoryId: item.categoryId,
    title: item.title,
    artworkUrl: item.posterUrl,
    rating: 7.5,
    description: item.description,
    syncGeneration: generation,
  };
}

await resetCatalogDatabaseForTests();
setCatalogDatabaseOpenerForTests(createNodeSqliteCatalogOpener());
await initializeCatalogDatabase(':memory:');
await upsertCatalogProvider({ providerId: 'bench', providerType: 'xtream' });
const generation = await beginCatalogSync('bench', 'movie', { phase: 'items' });

const N = 9000; // large category stand-in
const source = makeItems(N);

// --- Old path shape: full map → chunk arrays → write ---
const oldStart = now();
let oldMaxSync = 0;
const mapped = source.map((item) => mapItem(item, 'bench', generation));
const mapDone = now();
const chunks = [];
for (let i = 0; i < mapped.length; i += 60) {
  chunks.push(mapped.slice(i, i + 60));
}
for (const chunk of chunks) {
  const s = now();
  await writeCatalogItemsBatch(chunk);
  oldMaxSync = Math.max(oldMaxSync, now() - s);
}
const oldTotal = now() - oldStart;

await resetCatalogDatabaseForTests();
setCatalogDatabaseOpenerForTests(createNodeSqliteCatalogOpener());
await initializeCatalogDatabase(':memory:');
await upsertCatalogProvider({ providerId: 'bench', providerType: 'xtream' });
const generation2 = await beginCatalogSync('bench', 'movie', { phase: 'items' });

// --- New streaming path ---
const newStart = now();
let written = 0;
let newMaxChunk = 0;
const timing = await processStreamingBatches(
  source,
  (item) => mapItem(item, 'bench', generation2),
  async (batch) => {
    written += await writeCatalogItemsBatch(batch);
  },
  {
    kind: 'movieMapping',
    writeKind: 'itemWrites',
    targetMs: 45,
    softMs: 75,
    hardMs: 100,
    minItems: 8,
    maxItems: 64,
    onChunk: ({ chunkMs }) => {
      newMaxChunk = Math.max(newMaxChunk, chunkMs);
    },
  },
);
const newTotal = now() - newStart;

console.log(
  JSON.stringify(
    {
      itemCount: N,
      old: {
        fullMapMs: Math.round(mapDone - oldStart),
        totalMs: Math.round(oldTotal),
        maxTxMs: Math.round(oldMaxSync),
        peakMappedArray: mapped.length,
        chunkArrays: chunks.length,
      },
      streaming: {
        totalMs: Math.round(newTotal),
        maxChunkMs: Math.round(Math.max(newMaxChunk, timing.maxChunkMs)),
        chunks: timing.chunks,
        written,
        peakMappedArray: 'bounded-buffer-only',
      },
    },
    null,
    2,
  ),
);

assert.equal(written, N);
