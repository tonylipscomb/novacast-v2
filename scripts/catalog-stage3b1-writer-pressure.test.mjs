import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  processStreamingBatches,
} from '../src/features/catalog/jsChunkBudget.ts';

const budgetSource = await fs.readFile(
  new URL('../src/features/catalog/jsChunkBudget.ts', import.meta.url),
  'utf8',
);
const writerSource = await fs.readFile(
  new URL('../src/features/catalog/catalogSqliteSyncWriter.ts', import.meta.url),
  'utf8',
);
const repositorySource = await fs.readFile(
  new URL('../src/features/catalog/catalogRepository.ts', import.meta.url),
  'utf8',
);
const moviesSource = await fs.readFile(
  new URL('../src/features/movies/useMoviesScreenModel.ts', import.meta.url),
  'utf8',
);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('giant movie catalogs do not retain content IDs in JavaScript Sets', () => {
  assert.doesNotMatch(writerSource, /queuedContentIds|committedContentIds/);
  assert.match(repositorySource, /COUNT\(DISTINCT content_id\)/);
});

test('slow movie transactions shrink the learned batch size', async () => {
  const batches = [];
  await processStreamingBatches(
    Array.from({ length: 24 }, (_, index) => index),
    (item) => item,
    async (batch) => {
      batches.push(batch.length);
      await wait(80);
    },
    {
      kind: 'movieItemWrites',
      writeKind: 'movieItemWrites',
      minItems: 8,
      maxItems: 12,
      pressureMode: true,
    },
  );
  assert.ok(batches.length >= 2);
  assert.ok(batches.some((size) => size <= 8));
});

test('movie writer yields and pauses after pressure stalls', async () => {
  const pressure = [];
  const result = await processStreamingBatches(
    Array.from({ length: 8 }, (_, index) => index),
    (item) => item,
    async () => {
      await wait(260);
    },
    {
      kind: 'movieItemWrites',
      writeKind: 'movieItemWrites',
      minItems: 8,
      maxItems: 8,
      pressureMode: true,
      onChunk: (info) => pressure.push(info),
    },
  );
  assert.equal(result.pressurePauseCount, 1);
  assert.ok(pressure[0].eventLoopLagMs >= 250);
  assert.ok(pressure[0].pauseMs >= 25);
  assert.match(budgetSource, /if \(effectiveBusyMs >= 100\)/);
});

test('writer pressure diagnostics and compact completion accounting contain no payloads', () => {
  assert.match(writerSource, /\[Catalog Writer Pressure\]/);
  assert.match(writerSource, /peakBatchMs/);
  assert.match(writerSource, /pressurePauseCount/);
  assert.doesNotMatch(writerSource, /movie IDs|movieId|contentId.*console/);
});

test('category aggregation is a single SQLite finalization phase', () => {
  assert.match(repositorySource, /recomputeCategoryCounts\(providerId, mediaType, generation\)/);
  assert.match(repositorySource, /GROUP BY category_id/);
  assert.doesNotMatch(repositorySource, /getCatalogTotalCount\([^\n]*categoryId/);
});

test('UI refresh is category/page based and does not receive a full catalog array', () => {
  assert.match(moviesSource, /void loadCategories\(\)/);
  assert.match(moviesSource, /providerCategoryCount/);
  assert.doesNotMatch(moviesSource, /setVisibleMovies\([^)]*items\.map/);
});

test('Movies category publication is explicit and separate from shared Series readiness', () => {
  assert.match(repositorySource, /\[Catalog Categories Published\]/);
  assert.match(moviesSource, /subscribeMovieCatalogReady/);
  assert.doesNotMatch(moviesSource, /phase === 'ready'[\s\S]{0,300}loadCategories/);
});

test('Stage 3B barrier and old-generation preservation remain active', () => {
  assert.match(writerSource, /waitForCatalogSqliteWriterDrain/);
  assert.match(writerSource, /stage3b1-onn-writer-pressure-v1/);
  assert.match(repositorySource, /Old successful generation stays readable/);
});

test('Series, Live TV, playback, and Search remain outside the Movies writer pressure path', () => {
  assert.match(writerSource, /handle\.mediaType === 'movie'/);
  assert.match(moviesSource, /createSqliteMovieDataSource/);
  assert.match(writerSource, /pressureMode: handle\.mediaType === 'movie'/);
});
