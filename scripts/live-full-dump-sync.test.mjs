import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  assignLiveStreamCategoryId,
  canonicalLiveStreamId,
  decideLiveCatalogCompletion,
  derivedLiveCategoryName,
  LIVE_UNKNOWN_CATEGORY_ID,
  mergeLiveMetadataWithDumpCategories,
  unknownLiveStreamCategoryIds,
} from '../src/features/providers/liveCatalogCompletion.ts';
import { decodeLiveFullDumpUnique } from '../src/features/providers/liveCatalogCompleteness.ts';

const sync = await fs.readFile(new URL('../src/features/providers/providerCatalogSync.ts', import.meta.url), 'utf8');
const liveRepo = await fs.readFile(new URL('../src/features/providers/providerRepositories.ts', import.meta.url), 'utf8');
const movieFn = sync.slice(
  sync.indexOf('export async function runMovieCatalogSync'),
  sync.indexOf('export async function runSeriesCatalogSync'),
);
const seriesFn = sync.slice(
  sync.indexOf('export async function runSeriesCatalogSync'),
  sync.indexOf('export async function runLiveCatalogSync'),
);
const liveFn = sync.slice(
  sync.indexOf('export async function runLiveCatalogSync'),
  sync.indexOf('export async function runProviderCatalogSync'),
);
const liveRefresh = sync.slice(
  sync.indexOf('async function refreshLiveChannelSummary'),
  sync.indexOf('async function resolveAndRefreshLiveChannelCount'),
);
const movieSkip = sync.slice(
  sync.indexOf('async function shouldSkipMovieSync'),
  sync.indexOf('async function shouldSkipSeriesSync'),
);
const startFn = sync.slice(
  sync.indexOf('function startProviderCatalogSync'),
  sync.indexOf('export function scheduleProviderCatalogSync'),
);
const liveSearch = await fs.readFile(
  new URL('../src/features/search/liveSearchSqliteCatalog.ts', import.meta.url),
  'utf8',
);

test('source: live publishes from unfiltered dump; movies and series stay separate', () => {
  assert.match(liveFn, /decodeLiveFullDumpUnique/);
  assert.match(liveFn, /decideLiveCatalogCompletion/);
  assert.match(liveFn, /logLiveFullDumpSync/);
  assert.match(liveFn, /publishLiveSearchCatalogFromDump/);
  assert.match(liveFn, /strategy: 'full-dump-stream-category'/);
  assert.match(liveFn, /mergeLiveMetadataWithDumpCategories/);
  assert.match(liveFn, /emitLiveCompletenessFromAuthoritativeDump/);
  assert.match(liveFn, /getCategoryAccentHints/);
  assert.match(liveFn, /caller: 'live-worker'/);
  assert.doesNotMatch(liveFn, /live\.getCategories\(/);
  assert.match(startFn, /buildCatalogSyncKey\(providerId, 'live'\)/);
  assert.match(startFn, /scheduleCatalogSync\(\s*liveKey/);
  assert.match(startFn, /runLiveCatalogSync/);
  assert.match(startFn, /scheduleCatalogSync\(\s*movieKey/);
  assert.match(startFn, /scheduleCatalogSync\(\s*seriesKey/);
  assert.doesNotMatch(movieFn, /decodeLiveFullDumpUnique/);
  assert.doesNotMatch(seriesFn, /decodeLiveFullDumpUnique/);
  assert.doesNotMatch(movieFn, /auditLiveCatalogCompleteness|runLiveCatalogCompletenessAudit/);
  assert.doesNotMatch(seriesFn, /auditLiveCatalogCompleteness|runLiveCatalogCompletenessAudit/);
  assert.doesNotMatch(movieSkip, /resolveAndRefreshLiveChannelCount/);
  assert.doesNotMatch(seriesFn, /resolveAndRefreshLiveChannelCount/);
  assert.doesNotMatch(liveRefresh, /decodeLiveFullDumpUnique/);
  assert.doesNotMatch(liveRefresh, /publishLiveSearchCatalogFromDump/);
  assert.match(liveRefresh, /ensureLiveSearchSqliteCatalog/);
  assert.doesNotMatch(sync, /if \(!liveCategories\.length \|\| isSyncRunStale/);
  assert.match(liveRepo, /loadAuthoritativeLiveDump/);
  assert.match(liveRepo, /assignLiveStreamCategoryId/);
  assert.match(liveRepo, /mergeLiveMetadataWithDumpCategories/);
  assert.doesNotMatch(
    liveRepo.slice(liveRepo.indexOf('async getChannels'), liveRepo.indexOf('async getChannel(')),
    /XTREAM_MAX_ITEMS_PER_CATEGORY/,
  );
});

test('metadataCategoryCount=0 and 9736 dump channels all publish', () => {
  const streamCategoryIds = Array.from({ length: 260 }, (_, i) => String(i + 1));
  const merged = mergeLiveMetadataWithDumpCategories({
    metadata: [],
    streamCategoryIds,
    missingCategoryIdCount: 0,
  });
  assert.equal(merged.categories.length, 260);
  assert.equal(merged.streamCategoryIdsMissingFromMetadata.length, 260);
  const kept = Array.from({ length: 9736 }, (_, i) => ({
    id: String(i + 1),
    categoryId: String((i % 260) + 1),
  })).filter((channel) => merged.categories.some((category) => category.id === channel.categoryId));
  assert.equal(kept.length, 9736);
});

test('260 stream category IDs missing from metadata keep every channel', () => {
  const metadata = Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), name: `Meta ${i + 1}` }));
  const stream = Array.from({ length: 260 }, (_, i) => String(i + 1));
  const unknown = unknownLiveStreamCategoryIds(
    metadata.map((category) => category.id),
    stream,
  );
  assert.equal(unknown.length, 248);
  const merged = mergeLiveMetadataWithDumpCategories({
    metadata,
    streamCategoryIds: stream,
    missingCategoryIdCount: 0,
  });
  const knownNames = merged.categories.filter((category) => !category.derived);
  assert.equal(knownNames[0]?.name, 'Meta 1');
  const channels = stream.map((categoryId, index) => ({ id: String(index + 1), categoryId }));
  const dropped = channels.filter((channel) => !merged.categories.some((category) => category.id === channel.categoryId));
  assert.equal(dropped.length, 0);
});

test('duplicate live stream IDs are deduped by canonical id', async () => {
  const records = [];
  for (let i = 1; i <= 9736; i += 1) {
    records.push({
      mediaType: 'movie',
      contentId: String(i),
      categoryId: String((i % 260) + 1),
      title: `Ch ${i}`,
    });
  }
  for (let i = 1; i <= 5; i += 1) {
    records.push({
      mediaType: 'movie',
      contentId: String(i),
      categoryId: String(i),
      title: `dup-${i}`,
    });
  }
  assert.equal(records.length, 9741);
  const dump = await decodeLiveFullDumpUnique({
    providerId: 'p1',
    requestUrl: 'https://example.invalid/player_api.php?action=get_live_streams',
    streamDecode: async ({ filterCategoryId, onBatch }) => {
      assert.equal(filterCategoryId, 'all');
      await onBatch(records);
      return {
        matched: records.length,
        batches: 1,
        maxBatchSize: records.length,
        cancelled: false,
        usedNative: true,
        stats: { rawSeen: 9741, matched: 9741 },
      };
    },
  });
  assert.equal(dump.rawCount, 9741);
  assert.equal(dump.decodedCount, 9736);
  assert.equal(dump.distinctIds.size, 9736);
  assert.equal(dump.duplicateLiveStreamCount, 5);
  assert.equal(dump.uniqueRecords[0]?.title, 'Ch 1');
});

test('incomplete metadata does not remap channels onto a hidden fallback', () => {
  assert.equal(assignLiveStreamCategoryId('2392'), '2392');
  assert.equal(assignLiveStreamCategoryId(''), LIVE_UNKNOWN_CATEGORY_ID);
  assert.equal(derivedLiveCategoryName('2392'), 'Live 2392');
  assert.equal(derivedLiveCategoryName(LIVE_UNKNOWN_CATEGORY_ID), 'Unknown');
});

test('existing metadata labels are preserved when dump adds unknown ids', () => {
  const merged = mergeLiveMetadataWithDumpCategories({
    metadata: [{ id: '10', name: 'USA News' }],
    streamCategoryIds: ['10', '99'],
    missingCategoryIdCount: 0,
  });
  assert.equal(merged.categories.find((category) => category.id === '10')?.name, 'USA News');
  assert.equal(merged.categories.find((category) => category.id === '99')?.name, 'Live 99');
  assert.equal(merged.categories.find((category) => category.id === '99')?.derived, true);
});

test('failed dump keeps previous readable Live; successful dump publishes', () => {
  const base = {
    strategy: 'full-dump-stream-category',
    fullDumpCompleted: true,
    decodedLiveCount: 9736,
    distinctLiveStreamIds: 9736,
    categoryAssignmentFinished: true,
    cancelled: false,
    staleGeneration: false,
    fatalError: false,
  };
  assert.equal(decideLiveCatalogCompletion(base).publish, true);
  assert.equal(decideLiveCatalogCompletion(base).completionReason, 'full-dump-succeeded');
  assert.equal(decideLiveCatalogCompletion({ ...base, cancelled: true }).publish, false);
  assert.equal(decideLiveCatalogCompletion({ ...base, staleGeneration: true }).completionReason, 'cancelled-or-stale');
  assert.equal(decideLiveCatalogCompletion({ ...base, fullDumpCompleted: false }).publish, false);
  assert.equal(decideLiveCatalogCompletion({ ...base, distinctLiveStreamIds: 0 }).completionReason, 'full-dump-empty');
  assert.equal(decideLiveCatalogCompletion({ ...base, fatalError: true }).completionReason, 'fatal-decode-or-write');
  assert.match(liveFn, /publishLiveSearchCatalogFromDump/);
  assert.match(liveFn, /live-full-dump-failed/);
  assert.match(liveSearch, /retainedPreviousGeneration/);
  assert.match(liveSearch, /activateGeneration/);
});

test('source: live dump waits on the per-provider catalog network gate', () => {
  assert.match(liveFn, /decodeLiveFullDumpUnique/);
  assert.match(startFn, /runMovieCatalogSync/);
  assert.match(startFn, /runSeriesCatalogSync/);
  assert.match(startFn, /runLiveCatalogSync/);
  assert.match(startFn, /Promise\.allSettled/);
});

test('canonical live id prefers streamId then contentId', () => {
  assert.equal(canonicalLiveStreamId({ contentId: 'c', streamId: 's' }), 's');
  assert.equal(canonicalLiveStreamId({ contentId: 'c' }), 'c');
});
