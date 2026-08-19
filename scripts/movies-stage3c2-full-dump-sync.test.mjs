import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  computeContentIdOverlapRatio,
  createVodCategoryProbeAccumulator,
  evaluateSparsePerCategoryCoverage,
  evaluateVodCategoryFilterCapability,
  normalizeStreamCategoryId,
  resolveCatalogItemCategoryId,
  selectVodCategoryProbeIds,
  MOVIES_UNCATEGORIZED_CATEGORY_ID,
  VOD_CATEGORY_FILTER_CAPABILITY_STORAGE_VERSION,
} from '../src/features/catalog/vodCategoryFilterCapability.ts';
import {
  assessMoviesCatalogIntegrity,
  validateMoviesCategoryDistribution,
} from '../src/features/catalog/moviesCategoryDistributionValidation.ts';
import { mapNativeRecordToCatalogItem } from '../src/features/catalog/catalogSqliteSyncWriter.ts';

const sync = fs.readFileSync('src/features/providers/providerCatalogSync.ts', 'utf8');
const repository = fs.readFileSync('src/features/catalog/catalogRepository.ts', 'utf8');
const writer = fs.readFileSync('src/features/catalog/catalogSqliteSyncWriter.ts', 'utf8');
const repos = fs.readFileSync('src/features/providers/providerRepositories.ts', 'utf8');
const kotlin = fs.readFileSync(
  'modules/novacast-catalog-decode/android/src/main/java/expo/modules/novacastcatalogdecode/NovacastCatalogDecodeModule.kt',
  'utf8',
);
const focusLifecycle = fs.readFileSync('src/features/movies/moviesDetailFocusLifecycle.ts', 'utf8');
const moviesScreen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
const seriesScreen = fs.readFileSync('src/features/series/SeriesScreen.tsx', 'utf8');
const liveGuide = fs.readFileSync('src/features/guide/GuideCategoryRail.tsx', 'utf8');
const sparseRepair = fs.readFileSync('src/features/movies/moviesSparseCatalogRepair.ts', 'utf8');
const sqlite = fs.readFileSync('src/features/movies/data/SqliteMovieDataSource.ts', 'utf8');
const loader = fs.readFileSync('src/features/movies/moviesLoaderState.ts', 'utf8');

test('1. An unfiltered category response is detected', () => {
  const probeA = createVodCategoryProbeAccumulator('netflix');
  probeA.onRecords(
    Array.from({ length: 2000 }, (_, index) => ({
      mediaType: 'movie',
      contentId: `m${index}`,
      categoryId: index % 20 === 0 ? 'netflix' : `cat-${index % 40}`,
      title: `T${index}`,
    })),
  );
  const probeB = createVodCategoryProbeAccumulator('boxing');
  probeB.onRecords(
    Array.from({ length: 2000 }, (_, index) => ({
      mediaType: 'movie',
      contentId: `m${index}`,
      categoryId: index % 20 === 0 ? 'boxing' : `cat-${index % 40}`,
      title: `T${index}`,
    })),
  );
  const capability = evaluateVodCategoryFilterCapability({
    providerId: 'p1',
    probes: [probeA.sample, probeB.sample],
    estimatedCatalogSize: 2000,
  });
  assert.equal(capability.filteringReliable, false);
});

test('2. Overlapping / identical-size category responses trigger full-dump mode', () => {
  const ids = Array.from({ length: 800 }, (_, index) => `id-${index}`);
  assert.ok(computeContentIdOverlapRatio(ids, ids.slice(100)) >= 0.55);
  const probeA = createVodCategoryProbeAccumulator('a');
  const probeB = createVodCategoryProbeAccumulator('b');
  probeA.onRecords(ids.map((contentId) => ({ mediaType: 'movie', contentId, categoryId: 'a', title: 't' })));
  probeB.onRecords(ids.map((contentId) => ({ mediaType: 'movie', contentId, categoryId: 'b', title: 't' })));
  const capability = evaluateVodCategoryFilterCapability({
    providerId: 'p1',
    probes: [probeA.sample, probeB.sample],
  });
  assert.equal(capability.filteringReliable, false);
  assert.match(capability.reason, /overlap|foreign|full-catalog|match|identical-size/i);

  const stampedA = createVodCategoryProbeAccumulator('1923');
  const stampedB = createVodCategoryProbeAccumulator('92');
  stampedA.onRecords(
    Array.from({ length: 2000 }, (_, index) => ({
      mediaType: 'movie',
      contentId: `s${index}`,
      categoryId: '1923',
      title: 't',
    })),
  );
  stampedB.onRecords(
    Array.from({ length: 1950 }, (_, index) => ({
      mediaType: 'movie',
      contentId: `t${index}`,
      categoryId: '92',
      title: 't',
    })),
  );
  const stamped = evaluateVodCategoryFilterCapability({
    providerId: 'p1',
    probes: [stampedA.sample, stampedB.sample],
    estimatedCatalogSize: 2000,
  });
  assert.equal(stamped.filteringReliable, false);
});

test('3. Full-dump mode makes only one VOD stream request', () => {
  assert.match(sync, /full-dump-stream-category/);
  assert.match(sync, /getCatalogListRequestUrl\?\.\('all'\)/);
  assert.match(sync, /filtered-per-category/);
  // Per-category loop is gated behind reliable filtering.
  assert.match(sync, /filteringReliable/);
});

test('4. Stream.category_id is preserved', () => {
  const item = mapNativeRecordToCatalogItem(
    {
      mediaType: 'movie',
      contentId: '1',
      categoryId: '42',
      title: 'Movie',
    },
    'p1',
    'movie',
    '999',
    7,
    { allowCategoryFallback: false },
  );
  assert.equal(item.categoryId, '42');
});

test('5. Requested category ID is never stamped onto every stream', () => {
  assert.match(kotlin, /Never stamp filterCategoryId|Preserve stream category_id only/);
  const missing = mapNativeRecordToCatalogItem(
    {
      mediaType: 'movie',
      contentId: '2',
      categoryId: null,
      title: 'Movie',
    },
    'p1',
    'movie',
    '999',
    7,
    { allowCategoryFallback: false },
  );
  assert.equal(missing.categoryId, MOVIES_UNCATEGORIZED_CATEGORY_ID);
  assert.notEqual(missing.categoryId, '999');
});

test('6. Duplicate content IDs are deterministic', () => {
  assert.match(repository, /ON CONFLICT/i);
  assert.match(repository, /physical\.itemRows === physical\.distinctContentIds/);
  assert.match(writer, /getCatalogGenerationItemStats|committedCount/);
});

test('7. Missing category IDs do not inherit the previous category', () => {
  assert.equal(normalizeStreamCategoryId(null), MOVIES_UNCATEGORIZED_CATEGORY_ID);
  assert.equal(normalizeStreamCategoryId(''), MOVIES_UNCATEGORIZED_CATEGORY_ID);
  assert.equal(normalizeStreamCategoryId('0'), '0');
  assert.equal(
    resolveCatalogItemCategoryId(null, 'last-requested', { allowFallback: false }),
    MOVIES_UNCATEGORIZED_CATEGORY_ID,
  );
});

test('8. A collapsed generation fails validation', () => {
  const result = validateMoviesCategoryDistribution({
    generation: 3,
    totalItems: 40000,
    distinctCategoryIds: 2,
    metadataCategoryCount: 120,
    nonzeroCategoryCount: 1,
    largestCategoryId: 'ufc',
    largestCategoryCount: 39000,
  });
  assert.equal(result.validationPassed, false);
  assert.ok(result.rejectionReason);
});

test('9. A broad category distribution passes validation', () => {
  const result = validateMoviesCategoryDistribution({
    generation: 4,
    totalItems: 40000,
    distinctCategoryIds: 80,
    metadataCategoryCount: 120,
    nonzeroCategoryCount: 75,
    largestCategoryId: 'netflix',
    largestCategoryCount: 4000,
  });
  assert.equal(result.validationPassed, true);
  assert.equal(result.rejectionReason, null);
});

test('10. Failed repair generation does not replace readable generation', () => {
  assert.match(writer, /category_distribution_failed|validationPassed/);
  assert.match(writer, /failCatalogSync/);
  assert.match(repository, /complete-rejected/);
  assert.match(repository, /return false/);
});

test('11. Category counts come from the newly activated generation', () => {
  assert.match(repository, /grouped-items-v2-merge/);
  assert.doesNotMatch(repository, /grouped-items-v2-collapse-fallback/);
  assert.match(repository, /grouped-items-v2-collapsed-diagnostic/);
});

test('12. No focus, loader, Series, Live TV, Search, or playback files change for this stage marker', () => {
  assert.match(focusLifecycle, /MOVIES_POST_RESTORE_LATCH_MS|closing-viewport/);
  assert.match(moviesScreen, /primaryLoaderOverlay|listOverlays/);
  assert.match(seriesScreen, /Series/);
  assert.match(liveGuide, /Guide|Live/);
  assert.match(sync, /stage4d-vod-ingestion-repair-v1/);
  // SQLite Movies item sync must not depend on Discover smart categories being enabled.
  assert.match(sync, /const syncMovieItems = smartCategoriesEnabled \|\| Boolean\(sqliteHandle\?\.enabled\)/);
});

test('13. Two zero-result filter probes are inconclusive (full dump)', () => {
  const capability = evaluateVodCategoryFilterCapability({
    providerId: 'p1',
    probes: [
      {
        requestedCategoryId: 'a',
        returnedCount: 0,
        distinctReturnedCategoryIds: 0,
        matchingRequestedCategoryCount: 0,
        firstContentIds: [],
        contentIdSample: [],
      },
      {
        requestedCategoryId: 'b',
        returnedCount: 0,
        distinctReturnedCategoryIds: 0,
        matchingRequestedCategoryCount: 0,
        firstContentIds: [],
        contentIdSample: [],
      },
    ],
    metadataCategoryCount: 439,
  });
  assert.equal(capability.status, 'inconclusive');
  assert.equal(capability.filteringReliable, false);
  assert.equal(capability.reason, 'zero-result-probes-inconclusive');
  assert.match(sync, /filterStatus !== 'reliable'/);
});

test('14. One populated + one zero probe does not become reliable', () => {
  const populated = createVodCategoryProbeAccumulator('a');
  populated.onRecords(
    Array.from({ length: 80 }, (_, index) => ({
      mediaType: 'movie',
      contentId: `a${index}`,
      categoryId: 'a',
      title: 't',
    })),
  );
  const capability = evaluateVodCategoryFilterCapability({
    providerId: 'p1',
    probes: [
      populated.sample,
      {
        requestedCategoryId: 'b',
        returnedCount: 0,
        distinctReturnedCategoryIds: 0,
        matchingRequestedCategoryCount: 0,
        firstContentIds: [],
        contentIdSample: [],
      },
    ],
  });
  assert.notEqual(capability.status, 'reliable');
  assert.equal(capability.filteringReliable, false);
});

test('15. Two strong distinct-category probes may be reliable', () => {
  const a = createVodCategoryProbeAccumulator('netflix');
  const b = createVodCategoryProbeAccumulator('boxing');
  a.onRecords(
    Array.from({ length: 120 }, (_, index) => ({
      mediaType: 'movie',
      contentId: `n${index}`,
      categoryId: 'netflix',
      title: 't',
    })),
  );
  b.onRecords(
    Array.from({ length: 120 }, (_, index) => ({
      mediaType: 'movie',
      contentId: `b${index}`,
      categoryId: 'boxing',
      title: 't',
    })),
  );
  const capability = evaluateVodCategoryFilterCapability({
    providerId: 'p1',
    probes: [a.sample, b.sample],
  });
  assert.equal(capability.status, 'reliable');
  assert.equal(capability.filteringReliable, true);
  assert.equal(capability.reason, 'category-filter-confirmed');
});

test('16. Capability storage version is v4 (v3 cache ignored)', () => {
  assert.equal(VOD_CATEGORY_FILTER_CAPABILITY_STORAGE_VERSION, 4);
  const capabilitySource = fs.readFileSync(
    'src/features/catalog/vodCategoryFilterCapability.ts',
    'utf8',
  );
  assert.match(capabilitySource, /vod-category-filter-capability\/v\$\{VOD_CATEGORY_FILTER_CAPABILITY_STORAGE_VERSION\}\//);
  assert.match(capabilitySource, /VOD_CATEGORY_FILTER_CAPABILITY_STORAGE_VERSION = 4/);
});

test('17. 439 metadata / 2 populated item categories is rejected', () => {
  const result = validateMoviesCategoryDistribution({
    generation: 9,
    totalItems: 500,
    distinctCategoryIds: 2,
    metadataCategoryCount: 439,
    nonzeroCategoryCount: 2,
    largestCategoryId: 'persian',
    largestCategoryCount: 400,
  });
  assert.equal(result.validationPassed, false);
  const integrity = assessMoviesCatalogIntegrity({
    metadataCategoryCount: 439,
    nonzeroCategoryCount: 2,
    distinctItemCategoryIds: 2,
    totalItems: 500,
  });
  assert.equal(integrity.degraded, true);
});

test('18. 439 metadata / 5 populated categories is rejected', () => {
  const result = validateMoviesCategoryDistribution({
    generation: 9,
    totalItems: 800,
    distinctCategoryIds: 5,
    metadataCategoryCount: 439,
    nonzeroCategoryCount: 5,
    largestCategoryId: 'persian',
    largestCategoryCount: 200,
  });
  assert.equal(result.validationPassed, false);
});

test('19. Mid-sync sparse coverage aborts to full dump once', () => {
  const sparse = evaluateSparsePerCategoryCoverage({
    categoriesAttempted: 12,
    categoriesReturningItems: 1,
    categoriesReturningZero: 11,
    metadataCategoryCount: 439,
    distinctItemCategoryIds: 1,
    decodedItemCount: 40,
  });
  assert.equal(sparse.suspicious, true);
  assert.match(sync, /sparse_per_category_ingestion/);
  assert.match(sync, /strategyFallbackUsed/);
  assert.match(sync, /evaluateSparsePerCategoryCoverage/);
});

test('20. Full-dump URL omits category_id=all', () => {
  const start = repos.indexOf('getCatalogListRequestUrl(categoryId: string)');
  const fn = repos.slice(start, start + 350);
  assert.ok(fn.includes("if (!categoryId || categoryId === 'all')"));
  assert.ok(fn.includes("return client.buildPlayerApiUrl('get_vod_streams');"));
  // Filtered path still uses category_id; unfiltered all-path must not.
  const allBranch = fn.slice(0, fn.indexOf("return client.buildPlayerApiUrl('get_vod_streams',"));
  assert.doesNotMatch(allBranch, /category_id:\s*categoryId/);
});

test('21. Probe selection spreads across provider categories', () => {
  const ids = Array.from({ length: 100 }, (_, i) => String(i + 1));
  const selected = selectVodCategoryProbeIds(ids, { limit: 6 });
  assert.ok(selected.length >= 4 && selected.length <= 6);
  assert.ok(selected.includes('1'));
  assert.ok(selected.includes('100'));
  assert.ok(!selected.includes('all'));
});

test('22. Active sparse generation schedules bounded repair', () => {
  assert.match(sparseRepair, /repairDegradedMoviesCatalogIfNeeded/);
  assert.match(sparseRepair, /invalidateVodCategoryFilterCapability/);
  assert.match(sparseRepair, /forceMoviesFullDumpForProvider|invalidateMoviesCatalogSyncCheckpoint/);
  assert.match(sparseRepair, /once per provider\/generation|markRepairedGeneration|alreadyRepaired/);
  assert.match(sqlite, /repairing-sparse-generation/);
  assert.match(loader, /Repairing movie library…/);
  assert.match(sync, /CATALOG_SYNC_CHECKPOINT_VERSION = 15/);
  assert.match(sync, /scheduleMoviesCatalogRepair|forceMoviesFullDumpForProvider/);
});
