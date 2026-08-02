import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { getActiveSmartCategoryDefinitions } from '../src/features/movies/smart/smartCategoryDefinitions.ts';
import { getActiveSmartSeriesCategoryDefinitions } from '../src/features/series/smart/smartSeriesCategoryDefinitions.ts';
import { DEFAULT_BROWSE_CATEGORY_ID, findDefaultBrowseCategoryId } from '../src/features/media-browser/mediaCategoryUtils.ts';

const repository = fs.readFileSync('src/features/catalog/catalogRepository.ts', 'utf8');
const sync = fs.readFileSync('src/features/providers/providerCatalogSync.ts', 'utf8');
const movieDefs = fs.readFileSync('src/features/movies/smart/smartCategoryDefinitions.ts', 'utf8');
const seriesDefs = fs.readFileSync('src/features/series/smart/smartSeriesCategoryDefinitions.ts', 'utf8');
const sqliteSource = fs.readFileSync('src/features/movies/data/SqliteMovieDataSource.ts', 'utf8');

test('Stage 3C.2 replaces reactive repair with capability-gated full dump', () => {
  assert.match(sync, /full-dump-stream-category/);
  assert.match(sync, /evaluateVodCategoryFilterCapability|VOD Category Filter Capability/);
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
