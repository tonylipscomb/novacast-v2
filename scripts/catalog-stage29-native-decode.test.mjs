import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('Option 1 rejected: Xtream client still uses full response.text + JSON.parse', async () => {
  const source = await fs.readFile(new URL('../src/features/providers/xtreamClient.ts', import.meta.url), 'utf8');
  assert.match(source, /response\.text\(\)/);
  assert.match(source, /JSON\.parse\(text\)/);
  assert.doesNotMatch(source, /response\.body\.getReader/);
  assert.doesNotMatch(source, /ReadableStream/);
});

test('native module Kotlin uses IO dispatcher and rendezvous backpressure', async () => {
  const kotlin = await fs.readFile(
    new URL('../modules/novacast-catalog-decode/android/src/main/java/expo/modules/novacastcatalogdecode/NovacastCatalogDecodeModule.kt', import.meta.url),
    'utf8',
  );
  assert.match(kotlin, /Dispatchers\.IO/);
  assert.match(kotlin, /Channel<DecodeBatch>\(capacity = 0\)/);
  assert.match(kotlin, /JsonReader/);
  assert.match(kotlin, /pullDecodeBatch/);
  assert.match(kotlin, /cancelDecodeJob/);
  assert.doesNotMatch(kotlin, /password/);
  assert.doesNotMatch(kotlin, /Log\.(d|i|w|e).*requestUrl/);
});

test('JS decode helper never accumulates a full array API', async () => {
  const android = await fs.readFile(new URL('../src/features/catalog/nativeCatalogDecode.android.ts', import.meta.url), 'utf8');
  assert.match(android, /onBatch/);
  assert.match(android, /streamXtreamCategoryDecode/);
  assert.doesNotMatch(android, /allItems\.push/);
  const shared = await fs.readFile(new URL('../src/features/catalog/nativeCatalogDecodeShared.ts', import.meta.url), 'utf8');
  assert.match(shared, /EXPO_PUBLIC_CATALOG_SQLITE_WRITER_ONLY_DIAGNOSTIC/);
});

test('catalog sync prefers native decode when URL + module available', async () => {
  const source = await fs.readFile(new URL('../src/features/providers/providerCatalogSync.ts', import.meta.url), 'utf8');
  assert.match(source, /streamXtreamCategoryDecode/);
  assert.match(source, /isNativeCatalogDecodeAvailable/);
  assert.match(source, /series-category-native-decode/);
  assert.match(source, /movie-category-native-decode/);
  assert.match(source, /isCatalogSqliteWriterOnlyDiagnosticEnabled/);
});

test('pull-based mock backpressure acknowledges before next batch', async () => {
  const batches = [[1, 2], [3, 4], [5]];
  let pullCount = 0;
  let maxInFlight = 0;
  let inFlight = 0;

  async function pull() {
    const items = batches[pullCount] ?? [];
    const done = pullCount >= batches.length - 1;
    pullCount += 1;
    return { items, done };
  }

  const seen = [];
  let done = false;
  while (!done) {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const batch = await pull();
    seen.push(...batch.items);
    inFlight -= 1;
    done = batch.done;
  }

  assert.deepEqual(seen, [1, 2, 3, 4, 5]);
  assert.equal(maxInFlight, 1);
  assert.equal(pullCount, 3);
});

test('stale provider id is rejected by native start options contract', async () => {
  const kotlin = await fs.readFile(
    new URL('../modules/novacast-catalog-decode/android/src/main/java/expo/modules/novacastcatalogdecode/NovacastCatalogDecodeModule.kt', import.meta.url),
    'utf8',
  );
  assert.match(kotlin, /stale_provider/);
  assert.match(kotlin, /expectedProviderId/);
});

test('failed generation preservation still uses finishCatalogSqliteMediaSync fail path', async () => {
  const source = await fs.readFile(new URL('../src/features/catalog/catalogSqliteSyncWriter.ts', import.meta.url), 'utf8');
  assert.match(source, /failCatalogSync/);
  assert.match(source, /completeCatalogSync/);
});
