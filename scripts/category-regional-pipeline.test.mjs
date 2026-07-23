import assert from 'node:assert/strict';
import test from 'node:test';

import { displayProviderCategoryName } from '../src/features/providers/categoryDisplay.ts';
import {
  analyzeCategoryScriptProfile,
  buildCategoryRegionalProfile,
  resolveCategoryDisplayName,
  resolveCategoryRegionGroup,
  sortProviderCategoriesByRegion,
} from '../src/features/providers/categoryRegionalPipeline.ts';
import {
  isUsAmericanLiveLabel,
  sortLiveCategoriesUsFirst,
} from '../src/features/providers/usAmericanSort.ts';

test('analyzeCategoryScriptProfile detects latin, mixed, and foreign scripts', () => {
  assert.equal(analyzeCategoryScriptProfile(['English Movies']), 'latin');
  assert.equal(analyzeCategoryScriptProfile(['Kids عربي']), 'mixed');
  assert.equal(analyzeCategoryScriptProfile(['رمضان']), 'foreign');
  assert.equal(analyzeCategoryScriptProfile(['Русский']), 'foreign');
});

test('resolveCategoryDisplayName relabels English and US categories without changing provider ids', () => {
  assert.equal(
    resolveCategoryDisplayName({ name: 'English', contentType: 'live' }),
    'International English',
  );
  assert.equal(
    resolveCategoryDisplayName({ name: 'English Series', contentType: 'series' }),
    'International English Series',
  );
  assert.equal(resolveCategoryDisplayName({ name: 'US', contentType: 'live' }), 'US Entertainment');
  assert.equal(resolveCategoryDisplayName({ name: 'USA', contentType: 'movie' }), 'US Movies');
  assert.equal(resolveCategoryDisplayName({ name: 'British', contentType: 'live' }), 'United Kingdom');
  assert.equal(resolveCategoryDisplayName({ name: 'UK', contentType: 'series' }), 'United Kingdom');
});

test('sortProviderCategoriesByRegion matches the documented validation order', () => {
  const sorted = sortProviderCategoriesByRegion(
    [
      { id: 'english-series', name: 'English Series' },
      { id: 'us', name: 'US' },
      { id: 'usa', name: 'USA' },
      { id: 'english', name: 'English' },
      { id: 'british', name: 'British' },
      { id: 'uk', name: 'UK' },
      { id: 'canada', name: 'Canada' },
      { id: 'australia', name: 'Australia' },
      { id: 'mixed', name: 'Kids عربي' },
      { id: 'ramadan', name: 'رمضان' },
      { id: 'russian', name: 'Русский' },
      { id: 'korean', name: '한국' },
      { id: 'japanese', name: '日本' },
    ],
    { contentType: 'live' },
  );

  assert.deepEqual(
    sorted.map((category) => displayProviderCategoryName({ name: category.name, contentType: 'live' })),
    [
      'US Entertainment',
      'US Entertainment',
      'Canada',
      'Australia',
      'International English',
      'International English Series',
      'United Kingdom',
      'United Kingdom',
      'Kids عربي',
      'Русский',
      'رمضان',
      '한국',
      '日本',
    ],
  );
});

test('mixed-language categories sort below English and above fully foreign categories', () => {
  const sorted = sortProviderCategoriesByRegion(
    [
      { id: 'foreign', name: 'Русский' },
      { id: 'english', name: 'English' },
      { id: 'mixed', name: 'Kids عربي' },
    ],
    { contentType: 'live' },
  );

  assert.deepEqual(
    sorted.map((category) => category.id),
    ['english', 'mixed', 'foreign'],
  );
});

test('resolveCategoryRegionGroup is data-driven and unicode aware', () => {
  assert.equal(resolveCategoryRegionGroup(['US'], 'latin', 'US'), 'us');
  assert.equal(resolveCategoryRegionGroup(['Canada'], 'latin', 'CA'), 'canada');
  assert.equal(resolveCategoryRegionGroup(['English'], 'latin'), 'intlEnglish');
  assert.equal(resolveCategoryRegionGroup(['Kids عربي'], 'mixed'), 'mixed');
  assert.equal(resolveCategoryRegionGroup(['رمضان'], 'foreign'), 'foreign');
});

test('sortLiveCategoriesUsFirst keeps US categories ahead of Canada and the United Kingdom', () => {
  const sorted = sortLiveCategoriesUsFirst([
    { id: '1', name: 'UK Entertainment', countryCode: 'GB' },
    { id: '2', name: 'USA Sports' },
    { id: '3', name: 'Canada News', countryCode: 'CA' },
    { id: '4', name: 'USA News' },
    { id: '5', name: 'International Mix' },
  ]);

  assert.deepEqual(
    sorted.map((category) => category.id),
    ['4', '2', '3', '1', '5'],
  );
});

test('sortLiveCategoriesUsFirst pushes Hindi and religious categories to the end', () => {
  const sorted = sortLiveCategoriesUsFirst([
    { id: '1', name: 'HINDI SERIES' },
    { id: '2', name: 'US SERIES' },
    { id: '3', name: 'ENGLISH SERIES' },
    { id: '4', name: 'TAMIL MOVIES' },
    { id: '5', name: 'GENERAL' },
    { id: '6', name: 'ISLAMIC MOVIES' },
  ]);

  assert.deepEqual(
    sorted.map((category) => category.id),
    ['2', '3', '5', '1', '6', '4'],
  );
});

test('isUsAmericanLiveLabel still detects common USA naming', () => {
  assert.equal(isUsAmericanLiveLabel('USA Entertainment', 'US'), true);
  assert.equal(isUsAmericanLiveLabel('4K US SERIES'), true);
  assert.equal(isUsAmericanLiveLabel('UK SERIES', 'GB'), false);
});

test('buildCategoryRegionalProfile preserves sort labels for alphabetical grouping', () => {
  const profile = buildCategoryRegionalProfile({ name: 'Canada', contentType: 'live' });
  assert.equal(profile.regionGroup, 'canada');
  assert.equal(profile.displayName, 'Canada');
  assert.equal(profile.sortPriority, 1);
});
