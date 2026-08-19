import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { getActiveSmartCategoryDefinitions } from '../src/features/movies/smart/smartCategoryDefinitions.ts';
import { getActiveSmartSeriesCategoryDefinitions } from '../src/features/series/smart/smartSeriesCategoryDefinitions.ts';
import { DEFAULT_BROWSE_CATEGORY_ID, findDefaultBrowseCategoryId } from '../src/features/media-browser/mediaCategoryUtils.ts';
import {
  assessMoviesCatalogIntegrity,
  validateMoviesCategoryDistribution,
} from '../src/features/catalog/moviesCategoryDistributionValidation.ts';
import {
  evaluateSparsePerCategoryCoverage,
  evaluateVodCategoryFilterCapability,
  VOD_CATEGORY_FILTER_CAPABILITY_STORAGE_VERSION,
} from '../src/features/catalog/vodCategoryFilterCapability.ts';

const repository = fs.readFileSync('src/features/catalog/catalogRepository.ts', 'utf8');
const sync = fs.readFileSync('src/features/providers/providerCatalogSync.ts', 'utf8');
const movieDefs = fs.readFileSync('src/features/movies/smart/smartCategoryDefinitions.ts', 'utf8');
const seriesDefs = fs.readFileSync('src/features/series/smart/smartSeriesCategoryDefinitions.ts', 'utf8');
const sqliteSource = fs.readFileSync('src/features/movies/data/SqliteMovieDataSource.ts', 'utf8');
const sparseRepair = fs.readFileSync('src/features/movies/moviesSparseCatalogRepair.ts', 'utf8');
const model = fs.readFileSync('src/features/movies/useMoviesScreenModel.ts', 'utf8');
const loader = fs.readFileSync('src/features/movies/moviesLoaderState.ts', 'utf8');

test('Stage 4.2D replaces reactive repair with capability-gated full dump', () => {
  assert.match(sync, /full-dump-stream-category/);
  assert.match(sync, /evaluateVodCategoryFilterCapability|VOD Category Filter Capability/);
  assert.match(sync, /stage4d-vod-ingestion-repair-v1/);
  assert.doesNotMatch(sync, /movie-unfiltered-repair-start/);
});

test('collapsed metadata-all rail is diagnostic only, not applied to browse', () => {
  assert.doesNotMatch(repository, /grouped-items-v2-collapse-fallback/);
  assert.match(repository, /grouped-items-v2-collapsed-diagnostic/);
  assert.match(sqliteSource, /refreshLooksCollapsed|collapsed-provider-rail/);
});

test('Features and New Releases remain disabled in Discover', () => {
  assert.match(movieDefs, /DISABLE_FEATURES_AND_NEW_RELEASES = true/);
  assert.match(seriesDefs, /DISABLE_FEATURES_AND_NEW_RELEASES = true/);
  const movieKeys = getActiveSmartCategoryDefinitions().map((definition) => definition.key);
  const seriesKeys = getActiveSmartSeriesCategoryDefinitions().map((definition) => definition.key);
  assert.ok(!movieKeys.includes('features'));
  assert.ok(!movieKeys.includes('new-releases'));
  assert.ok(!seriesKeys.includes('features'));
  assert.ok(!seriesKeys.includes('new-releases'));
});

test('default browse category is All Movies', () => {
  assert.equal(DEFAULT_BROWSE_CATEGORY_ID, 'all');
  assert.equal(
    findDefaultBrowseCategoryId([
      { id: 'all', name: 'All Movies', kind: 'provider' },
      { id: '1208', name: 'Netflix', kind: 'provider' },
    ]),
    'all',
  );
});

test('zero-result probes never certify filtering reliable', () => {
  const capability = evaluateVodCategoryFilterCapability({
    providerId: 'onn',
    probes: [
      {
        requestedCategoryId: '1',
        returnedCount: 0,
        distinctReturnedCategoryIds: 0,
        matchingRequestedCategoryCount: 0,
        firstContentIds: [],
        contentIdSample: [],
      },
      {
        requestedCategoryId: '2',
        returnedCount: 0,
        distinctReturnedCategoryIds: 0,
        matchingRequestedCategoryCount: 0,
        firstContentIds: [],
        contentIdSample: [],
      },
    ],
    metadataCategoryCount: 439,
  });
  assert.equal(capability.filteringReliable, false);
  assert.equal(capability.status, 'inconclusive');
});

test('439/2 and 439/5 sparse distributions are rejected and never activated', () => {
  for (const nonzero of [2, 5]) {
    const result = validateMoviesCategoryDistribution({
      generation: 3,
      totalItems: 1000,
      distinctCategoryIds: nonzero,
      metadataCategoryCount: 439,
      nonzeroCategoryCount: nonzero,
      largestCategoryId: 'persian',
      largestCategoryCount: 800,
    });
    assert.equal(result.validationPassed, false, `nonzero=${nonzero}`);
  }
  assert.match(fs.readFileSync('src/features/catalog/catalogSqliteSyncWriter.ts', 'utf8'), /failCatalogSync/);
});

test('healthy broad distribution remains accepted', () => {
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
});

test('per-category sparse sample aborts strategy once', () => {
  const sparse = evaluateSparsePerCategoryCoverage({
    categoriesAttempted: 12,
    categoriesReturningItems: 1,
    categoriesReturningZero: 11,
    metadataCategoryCount: 439,
    distinctItemCategoryIds: 1,
    decodedItemCount: 20,
  });
  assert.equal(sparse.suspicious, true);
  assert.match(sync, /sparse_per_category_ingestion/);
  assert.match(sync, /strategyFallbackUsed/);
});

test('existing sparse active generation is repaired without wiping Live/Series/credentials', () => {
  const integrity = assessMoviesCatalogIntegrity({
    metadataCategoryCount: 439,
    nonzeroCategoryCount: 2,
    distinctItemCategoryIds: 2,
    totalItems: 400,
  });
  assert.equal(integrity.degraded, true);
  assert.match(sparseRepair, /invalidateVodCategoryFilterCapability/);
  assert.match(sparseRepair, /Do not touch credentials|never clear credentials/);
  assert.match(sqliteSource, /repairDegradedMoviesCatalogIfNeeded/);
  // Stage 4.2I: preserve validated snapshot during repair (no blank rail).
  assert.match(
    sqliteSource,
    /snapshot-preserved-during-repair|movies_snapshot_preserved_during_repair|repairing-sparse-generation/,
  );
  assert.match(loader, /Repairing movie library…/);
  assert.match(model, /catalogRepairing|setMoviesCatalogRepairingUi/);
  assert.match(sync, /forceMoviesFullDumpForProvider/);
  assert.match(sync, /invalidateMoviesCatalogSyncCheckpoint/);
  assert.equal(VOD_CATEGORY_FILTER_CAPABILITY_STORAGE_VERSION, 4);
});

test('healthy generation during refresh remains preservable', () => {
  assert.match(sqliteSource, /preserving-completed-generation/);
  assert.match(sqliteSource, /previous\.categories/);
});
