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

test('movie category display removes bounded regional presentation prefixes only', () => {
  assert.equal(
    displayProviderCategoryName({ name: 'GR TURKISH MOVIES', contentType: 'movie', kind: 'provider' }),
    'TURKISH MOVIES',
  );
  assert.equal(
    displayProviderCategoryName({ name: 'GR HBO MAX', contentType: 'movie', kind: 'provider' }),
    'HBO MAX',
  );
  assert.equal(
    displayProviderCategoryName({ name: 'IL HEBREW DOCU-MOVIES', contentType: 'movie', kind: 'provider' }),
    'HEBREW DOCU-MOVIES',
  );
  assert.equal(
    displayProviderCategoryName({ name: 'USA Network', contentType: 'movie', kind: 'provider' }),
    'USA Network',
  );
});

test('live categories keep regional prefixes unless stripRegionPrefix is opted in', () => {
  // Default live behaviour is unchanged (Live TV rail keeps the presentation prefix).
  assert.equal(
    displayProviderCategoryName({ name: 'US DAZN PPV', contentType: 'live', kind: 'provider' }),
    'US Dazn Ppv',
  );
  // Guide rail opts in and reuses the shared movie/series prefix stripper.
  assert.equal(
    displayProviderCategoryName({ name: 'US DAZN PPV', contentType: 'live', kind: 'provider', stripRegionPrefix: true }),
    'Dazn Ppv',
  );
  // Non-region 2-letter leads are preserved (only bounded region codes are stripped).
  assert.equal(
    displayProviderCategoryName({ name: 'HD Sports', contentType: 'live', kind: 'provider', stripRegionPrefix: true }),
    displayProviderCategoryName({ name: 'HD Sports', contentType: 'live', kind: 'provider' }),
  );
});

test('series categories preserve regional tiers and clean presentation prefixes', () => {
  const categories = [
    { id: 'crunchyroll', name: 'CRUNCHYROLL SERIES (MULTI-SUBS)' },
    { id: 'discovery', name: 'DISCOVERY+ SERIES' },
    { id: 'apple', name: 'APPLE+ SERIES' },
    { id: 'netflix', name: 'NETFLIX SERIES' },
    { id: 'belgium-fr', name: 'BELGIUM SERIES (FR)' },
    { id: 'belgium-nl', name: 'BELGIUM SERIES (NL)' },
    { id: 'bulgaria', name: 'BULGARIA SERIAL' },
    { id: 'china', name: 'CHINA ANIMATION' },
    { id: 'dansk', name: 'DANSK SERIE' },
    { id: 'danske', name: 'DANSKE BØRN' },
    { id: 'africa', name: 'AFRICA SERIES' },
    { id: 'somalia', name: 'SOMALIA ENGLISH SERIES' },
    { id: 'albania', name: 'ALBANIA SERIALE' },
    { id: 'gr', name: 'GR APPLE+ SERIES' },
    { id: 'us', name: 'US SERIES' },
    { id: 'nl', name: 'NL NETFLIX SERIES' },
    { id: 'il', name: 'IL HEBREW SERIES' },
  ];
  const sorted = sortProviderCategoriesByRegion(categories, {
    contentType: 'series',
    alphabetizeWithinGroup: true,
  });
  assert.deepEqual(sorted.map((category) => category.id), [
    'us', 'apple', 'crunchyroll', 'discovery', 'netflix',
    'africa', 'albania', 'belgium-fr', 'belgium-nl', 'bulgaria', 'china', 'dansk', 'danske', 'gr', 'il', 'nl', 'somalia',
  ]);
  for (const name of [
    'BELGIUM SERIES (FR)', 'BELGIUM SERIES (NL)', 'BULGARIA SERIAL',
    'CHINA ANIMATION', 'DANSK SERIE', 'DANSKE BØRN', 'GR APPLE+ SERIES', 'NL NETFLIX SERIES',
  ]) {
    assert.equal(buildCategoryRegionalProfile({ name, contentType: 'series' }).regionGroup, 'foreign', name);
  }
  assert.equal(buildCategoryRegionalProfile({ name: 'CRUNCHYROLL SERIES (MULTI-SUBS)', contentType: 'series' }).regionGroup, 'international');
  assert.equal(buildCategoryRegionalProfile({ name: 'DISCOVERY+ SERIES', contentType: 'series' }).regionGroup, 'international');
  assert.equal(
    displayProviderCategoryName({ name: 'GR APPLE+ SERIES', contentType: 'series', kind: 'provider' }),
    'APPLE+ SERIES',
  );
  assert.equal(
    displayProviderCategoryName({ name: 'USA Network', contentType: 'series', kind: 'provider' }),
    'USA Network',
  );
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
