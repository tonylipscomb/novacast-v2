import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyNovaPulseRegion,
  curateNovaPulseCatalog,
  evaluateNovaPulseCuration,
  isNovaPulseAdultCategory,
} from '../src/features/novapulse/novaPulseCuration.ts';

function movie(id, categoryName, countryCode, title = `Movie ${id}`) {
  return {
    id,
    categoryId: categoryName,
    categoryName,
    countryCode,
    title,
    genres: ['Drama'],
    posterStyleKey: 'ember',
    posterUrl: `https://img.example/${id}.jpg`,
  };
}

function series(id, categoryName, countryCode, title = `Series ${id}`) {
  return {
    id,
    seriesId: id,
    categoryId: categoryName,
    categoryName,
    countryCode,
    title,
    genres: ['Drama'],
    posterStyleKey: 'ember',
    posterUrl: `https://img.example/${id}.jpg`,
  };
}

test('adult category classifier is exact and does not use title substrings', () => {
  for (const label of [
    'Adult',
    'Adult Movies',
    'For Adults',
    'Adults Only',
    'Adult Only',
    'For Adult',
    'XXX',
    'XXX Movies',
    '18+',
    '18+ Movies',
    'Porn',
    'Erotic',
    'US | Adult Movies',
    'US | FOR ADULTS',
    'FOR ADULTS | 4K',
    'VIP - FOR ADULTS',
    '[FOR ADULTS]',
  ]) {
    assert.equal(isNovaPulseAdultCategory(label), true, label);
  }
  assert.equal(isNovaPulseAdultCategory('fOr AdUlTs'), true);
  assert.equal(isNovaPulseAdultCategory('Adult Swim'), false);
  assert.equal(isNovaPulseAdultCategory('Action'), false);
  for (const title of [
    'xXx',
    'xXx: Return of Xander Cage',
    'Sex Education',
    'Sex and the City',
    'Adult Swim',
    '18 Again',
    'Essex',
    'Middlesex',
  ]) {
    assert.equal(evaluateNovaPulseCuration({ categoryName: 'Action', contentType: 'movie', contentPolicy: 'us_only' }).allowed, true, title);
  }
});

test('adult content stays excluded even when the safe catalog is sparse', () => {
  const result = curateNovaPulseCatalog(
    [movie('adult', 'Adult Movies', 'US'), movie('safe', 'Action', 'US')],
    [series('adult-series', 'XXX', 'US'), series('safe-series', 'Drama', 'US')],
    'us_only',
  );
  assert.deepEqual(result.movies.map((item) => item.id), ['safe']);
  assert.deepEqual(result.series.map((item) => item.id), ['safe-series']);
  assert.equal(result.diagnostics.adultRejected, 2);
});

test('US region is preferred, confirmed foreign is excluded, and unknown remains safe', () => {
  assert.equal(classifyNovaPulseRegion({ categoryName: 'US Movies', contentType: 'movie' }), 'us');
  assert.equal(classifyNovaPulseRegion({ countryCode: 'USA', contentType: 'movie' }), 'us');
  assert.equal(classifyNovaPulseRegion({ countryCode: 'United States', contentType: 'movie' }), 'us');
  assert.equal(classifyNovaPulseRegion({ countryCode: 'United States of America', contentType: 'movie' }), 'us');
  assert.equal(classifyNovaPulseRegion({ countryCode: 'PL', contentType: 'movie' }), 'foreign');
  assert.equal(classifyNovaPulseRegion({ categoryName: 'PL | Polish Movies', contentType: 'movie' }), 'foreign');
  assert.equal(classifyNovaPulseRegion({ categoryName: 'UK | British Series', contentType: 'series' }), 'foreign');
  assert.equal(classifyNovaPulseRegion({ categoryName: 'India | Hindi Movies', contentType: 'movie' }), 'foreign');
  assert.equal(classifyNovaPulseRegion({ categoryName: 'Latino | Spanish Movies', contentType: 'movie' }), 'foreign');
  // A language/locale marker alone is not treated as proof of country.
  assert.equal(classifyNovaPulseRegion({ countryCode: 'en-US', contentType: 'movie' }), 'unknown');
  assert.equal(classifyNovaPulseRegion({ countryCode: '1923', categoryName: 'Movies', contentType: 'movie' }), 'unknown');
  const result = curateNovaPulseCatalog(
    [movie('foreign', 'Movies', 'PL'), movie('unknown', 'Movies', undefined), movie('us', 'Movies', 'United States')],
    [],
    'us_only',
  );
  assert.deepEqual(result.movies.map((item) => item.id), ['us', 'unknown']);
  assert.equal(result.diagnostics.regionForeignRejected, 1);
  assert.equal(result.diagnostics.usMatches, 1);
  assert.equal(result.diagnostics.unknownRegion, 1);
});

test('explicit country wins over weaker category inference and adult wins over region', () => {
  assert.equal(classifyNovaPulseRegion({ countryCode: 'US', categoryName: 'PL | Polish Movies', contentType: 'movie' }), 'us');
  const adult = evaluateNovaPulseCuration({ countryCode: 'US', categoryName: 'US | XXX Movies', contentType: 'movie', contentPolicy: 'unrestricted' });
  assert.equal(adult.allowed, false);
  assert.equal(adult.reason, 'adult');
  const forAdults = evaluateNovaPulseCuration({ countryCode: 'US', categoryName: 'US | FOR ADULTS', contentType: 'movie', contentPolicy: 'unrestricted' });
  assert.equal(forAdults.allowed, false);
  assert.equal(forAdults.reason, 'adult');
});

test('FOR ADULTS remains excluded when the safe movie pool is sparse', () => {
  const result = curateNovaPulseCatalog(
    [movie('adult', 'FOR ADULTS', 'US'), movie('safe', 'Action', 'US')],
    [],
    'us_only',
  );
  assert.deepEqual(result.movies.map((item) => item.id), ['safe']);
  assert.equal(result.diagnostics.adultRejected, 1);
});

test('region-first bounded query contract keeps preferred items inside the capped pool', () => {
  const titleSortedRows = [
    { id: 'foreign-a', regionRank: 2, categoryName: 'PL | Polish Movies', title: 'A Foreign Movie' },
    { id: 'foreign-b', regionRank: 2, categoryName: 'UK | British Movies', title: 'B Foreign Movie' },
    { id: 'us-a', regionRank: 0, categoryName: 'US Movies', title: 'Z US Movie' },
  ];
  const boundedSqlResult = [...titleSortedRows]
    .sort((left, right) => left.regionRank - right.regionRank || left.title.localeCompare(right.title))
    .slice(0, 2);
  const curated = curateNovaPulseCatalog(
    boundedSqlResult.map((row) => movie(row.id, row.categoryName, undefined, row.title)),
    [],
    'us_only',
  );
  assert.deepEqual(curated.movies.map((item) => item.id), ['us-a']);
  assert.equal(curated.diagnostics.regionForeignRejected, 1);
});

test('unrestricted policy preserves foreign content while still preferring US', () => {
  const result = curateNovaPulseCatalog(
    [movie('foreign', 'Movies', 'PL'), movie('us', 'Movies', 'US')],
    [],
    'unrestricted',
  );
  assert.deepEqual(result.movies.map((item) => item.id), ['us', 'foreign']);
  assert.equal(result.diagnostics.regionForeignRejected, 0);
});

test('movie and series identity/title data are unchanged by curation', () => {
  const inputMovie = movie('raw-id', 'Action', 'US', 'Sex Education');
  const inputSeries = series('raw-series-id', 'Drama', undefined, 'Essex');
  const result = curateNovaPulseCatalog([inputMovie], [inputSeries], 'us_only');
  assert.equal(result.movies[0].id, 'raw-id');
  assert.equal(result.movies[0].title, 'Sex Education');
  assert.equal(result.series[0].id, 'raw-series-id');
  assert.equal(result.series[0].title, 'Essex');
});
