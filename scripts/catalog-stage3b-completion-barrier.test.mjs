import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  createDisabledCatalogSqliteMediaSyncHandle,
  waitForCatalogSqliteWriterDrain,
} from '../src/features/catalog/catalogSqliteSyncWriter.ts';

const writer = await fs.readFile(
  new URL('../src/features/catalog/catalogSqliteSyncWriter.ts', import.meta.url),
  'utf8',
);
const sync = await fs.readFile(
  new URL('../src/features/providers/providerCatalogSync.ts', import.meta.url),
  'utf8',
);
const movies = await fs.readFile(
  new URL('../src/features/movies/useMoviesScreenModel.ts', import.meta.url),
  'utf8',
);

test('completion waits for the final owned SQLite write to drain', async () => {
  const handle = createDisabledCatalogSqliteMediaSyncHandle('deferred-provider', 'movie');
  let releaseWrite;
  const writeHeld = new Promise((resolve) => {
    releaseWrite = resolve;
  });
  handle.accounting.pendingWriteCount = 1;
  handle.accounting.writerDrained = false;

  let drained = false;
  const drain = waitForCatalogSqliteWriterDrain(handle).then(() => {
    drained = true;
  });
  await Promise.resolve();
  assert.equal(drained, false);

  releaseWrite();
  await writeHeld;
  handle.accounting.pendingWriteCount = 0;
  await drain;
  assert.equal(drained, true);
  assert.equal(handle.accounting.writerDrained, true);
});

test('Movies completion barrier verifies rows before completeCatalogSync', () => {
  assert.match(writer, /\[Catalog Completion Barrier\]/);
  assert.match(writer, /getCatalogGenerationItemStats/);
  assert.match(writer, /pendingWriteCount === 0/);
  assert.match(writer, /dbRowCount === handle\.accounting\.committedCount/);
  assert.match(writer, /categories: handle\.pendingCategories/);
  assert.match(writer, /stage3b1-onn-writer-pressure-v1/);
  assert.match(sync, /nativeDone: true/);
  assert.match(sync, /createDisabledCatalogSqliteMediaSyncHandle/);
  assert.match(sync, /subscribeMovieCatalogReady/);
});

test('Stage 4 movie categories stream to SQLite while pendingCategories remain staged', () => {
  // Categories may stream for sync progress; Movies UI readiness is gated separately (4.2A).
  assert.match(writer, /Stage 4 \/ 4\.2A/);
  assert.match(writer, /must not treat/);
  assert.match(writer, /handle\.pendingCategories = categories\.map\(mapCategory\)/);
  assert.match(writer, /sqlite-categories-streamed/);
  assert.match(writer, /categories: handle\.pendingCategories/);
});

test('Movies reload categories once on the completed catalog-ready phase', () => {
  assert.match(movies, /subscribeMovieCatalogReady/);
  assert.match(movies, /catalog_ready_received/);
  assert.match(movies, /void loadCategories\(\)/);
  assert.match(movies, /reloadSmartCategoryGridIfNeeded\(\)/);
});

test('Series and Live TV paths remain separate from the movie barrier', () => {
  assert.match(sync, /runSeriesCatalogSync/);
  assert.match(sync, /resolveAndRefreshLiveChannelCount/);
  assert.match(writer, /handle\.mediaType === 'movie'/);
});
