import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  buildCategoryRegionalProfile,
  resolveCategoryRegionGroup,
  sortProviderCategoriesByRegion,
} from '../src/features/providers/categoryRegionalPipeline.ts';
import { sortProviderCategoriesUsFirst } from '../src/features/providers/usAmericanSort.ts';

const fixture = [
  'US Soccer American Football',
  'ITALIAN SUB ENG',
  'NL 2022 & OUD',
  'NL AMAZON PRIME',
  'GR ANIME',
  'GR APPLE+',
  'AL ARKIVA 1980/2023',
  'NL BIOSCOOP',
  'NL BIOSCOOP 4K',
  'APPLE+',
  'AMAZON PRIME',
  'NETFLIX',
  'TOP MOVIES',
  'HBO MAX',
];

const categories = fixture.map((name, index) => ({ id: String(index), name, rawName: name }));

test('US Movies use preferred → neutral/global → explicit regional presentation tiers', () => {
  const sorted = sortProviderCategoriesUsFirst(categories, 'movie').map((item) => item.name);
  const firstForeign = sorted.findIndex((name) => /^(?:NL|GR|AL)\b|^ITALIAN\b/.test(name));
  const lastNeutral = Math.max(...['APPLE+', 'AMAZON PRIME', 'NETFLIX', 'TOP MOVIES', 'HBO MAX'].map((name) => sorted.indexOf(name)));
  assert.ok(sorted[0] === 'US Soccer American Football');
  assert.ok(firstForeign > lastNeutral, `${sorted.join(' | ')}`);
});

test('Movies preserve provider order within each regional tier', () => {
  const input = ['US B', 'US A', 'GLOBAL B', 'GLOBAL A', 'GR B', 'GR A']
    .map((name, index) => ({ id: String(index), name, rawName: name }));
  const sorted = sortProviderCategoriesUsFirst(input, 'movie').map((item) => item.name);
  assert.deepEqual(sorted, ['US B', 'US A', 'GLOBAL B', 'GLOBAL A', 'GR B', 'GR A']);
});

test('explicit country tokens are recognized only from the bounded country-code set', () => {
  assert.equal(buildCategoryRegionalProfile({ name: 'GR APPLE+', contentType: 'movie' }).regionGroup, 'foreign');
  assert.equal(buildCategoryRegionalProfile({ name: 'NL AMAZON PRIME', contentType: 'movie' }).regionGroup, 'foreign');
  assert.equal(buildCategoryRegionalProfile({ name: 'APPLE+', contentType: 'movie' }).regionGroup, 'international');
  assert.equal(buildCategoryRegionalProfile({ name: 'XY APPLE+', contentType: 'movie' }).regionGroup, 'international');
  assert.equal(buildCategoryRegionalProfile({ name: 'ITALIAN SUB ENG', contentType: 'movie' }).regionGroup, 'foreign');
});

test('the same explicit region is local for a resolved Greek or Dutch user', () => {
  assert.equal(resolveCategoryRegionGroup(['GR APPLE+'], 'latin', undefined, 'GR', 'movie'), 'us');
  assert.equal(resolveCategoryRegionGroup(['NL AMAZON PRIME'], 'latin', undefined, 'NL', 'movie'), 'us');
  assert.equal(resolveCategoryRegionGroup(['GR APPLE+'], 'latin', undefined, 'NL', 'movie'), 'foreign');
});

test('SQLite smart wrapper preserves All Movies and sorts provider categories only', () => {
  const source = fs.readFileSync('src/features/movies/smart/SmartMovieDataSource.ts', 'utf8');
  assert.match(source, /SQLite path: provider-only list/);
  assert.match(source, /sortProviderCategoriesUsFirst\(realCategories, 'movie'\)/);
});
