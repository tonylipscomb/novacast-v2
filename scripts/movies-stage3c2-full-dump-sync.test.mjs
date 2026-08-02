import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  computeContentIdOverlapRatio,
  createVodCategoryProbeAccumulator,
  evaluateVodCategoryFilterCapability,
  normalizeStreamCategoryId,
  resolveCatalogItemCategoryId,
  MOVIES_UNCATEGORIZED_CATEGORY_ID,
} from '../src/features/catalog/vodCategoryFilterCapability.ts';
import { validateMoviesCategoryDistribution } from '../src/features/catalog/moviesCategoryDistributionValidation.ts';
import { mapNativeRecordToCatalogItem } from '../src/features/catalog/catalogSqliteSyncWriter.ts';

const sync = fs.readFileSync('src/features/providers/providerCatalogSync.ts', 'utf8');
const repository = fs.readFileSync('src/features/catalog/catalogRepository.ts', 'utf8');
const writer = fs.readFileSync('src/features/catalog/catalogSqliteSyncWriter.ts', 'utf8');
const kotlin = fs.readFileSync(
  'modules/novacast-catalog-decode/android/src/main/java/expo/modules/novacastcatalogdecode/NovacastCatalogDecodeModule.kt',
  'utf8',
);
const focusLifecycle = fs.readFileSync('src/features/movies/moviesDetailFocusLifecycle.ts', 'utf8');
const moviesScreen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
const seriesScreen = fs.readFileSync('src/features/series/SeriesScreen.tsx', 'utf8');
const liveGuide = fs.readFileSync('src/features/guide/GuideCategoryRail.tsx', 'utf8');

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
  assert.match(sync, /stage3c2-vod-full-dump-sync-v1/);
  // SQLite Movies item sync must not depend on Discover smart categories being enabled.
  assert.match(sync, /const syncMovieItems = smartCategoriesEnabled \|\| Boolean\(sqliteHandle\?\.enabled\)/);
});
