import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  getNovaPulseLanguageEvidence,
  isNovaPulseEnglishDescription,
  preferNovaPulseEnglishVariants,
  formatNovaPulseCatalogMeta,
  getNovaPulseDisplayRuntimeMinutes,
  normalizeNovaPulseYear,
  sanitizeNovaPulseDisplayTitle,
} from '../src/features/novapulse/novaPulseLogic.ts';
import { enrichNovaPulsePresentation } from '../src/features/novapulse/novaPulsePresentation.ts';

const source = fs.readFileSync(new URL('../src/features/novapulse/novaPulseSources.ts', import.meta.url), 'utf8');
const v2 = fs.readFileSync(new URL('../src/features/novapulse/novaPulseV2.ts', import.meta.url), 'utf8');

test('AR and AR-SUBS are known foreign language markers while A+ remains neutral', () => {
  assert.equal(getNovaPulseLanguageEvidence('AR - Coming to America'), 'foreign');
  assert.equal(getNovaPulseLanguageEvidence('AR-SUBS - Coming to America'), 'foreign');
  assert.equal(getNovaPulseLanguageEvidence('A+ - Coming to America'), 'neutral');
  assert.equal(getNovaPulseLanguageEvidence('US - Coming to America'), 'us-english');
});

test('English/US duplicate wins without changing provider identity', () => {
  const result = preferNovaPulseEnglishVariants([
    { id: 'arabic-id', title: 'Coming to America', rawTitle: 'AR - Coming to America', year: 1988 },
    { id: 'us-id', title: 'Coming to America', rawTitle: 'US - Coming to America', year: 1988 },
  ], 'movie');
  assert.deepEqual(result.items.map((item) => item.id), ['us-id']);
  assert.equal(result.diagnostics.foreignVariantsRejected, 1);
  assert.equal(sanitizeNovaPulseDisplayTitle('AR - Coming to America'), 'Coming to America');
});

test('foreign variant cannot win merely because it appeared first', () => {
  const result = preferNovaPulseEnglishVariants([
    { id: 'foreign-id', title: 'Dune', rawTitle: 'AR-SUBS - Dune', year: 2021, description: 'Arabic' },
    { id: 'neutral-id', title: 'Dune', rawTitle: 'Dune', year: 2021, description: 'An epic science-fiction adventure.' },
  ], 'movie');
  assert.equal(result.items[0].id, 'neutral-id');
});

test('description guard rejects Arabic, Cyrillic, and CJK but accepts English accents', () => {
  assert.equal(isNovaPulseEnglishDescription('هذا فيلم رائع'), false);
  assert.equal(isNovaPulseEnglishDescription('Это отличный фильм'), false);
  assert.equal(isNovaPulseEnglishDescription('这是一个精彩的电影'), false);
  assert.equal(isNovaPulseEnglishDescription('Beyoncé returns in Pokémon: résumé included.'), true);
  assert.equal(isNovaPulseEnglishDescription('A title with an unknown language marker.'), true);
});

test('rejected local description falls back to acceptable enriched description', () => {
  const result = enrichNovaPulsePresentation({
    items: [{ id: 'movie-1', type: 'movie', title: 'Movie', sourceItemId: 'm1', priority: 1, description: 'هذا فيلم رائع', action: { type: 'details', target: '/movies' } }],
    movies: [{ id: 'm1', categoryId: 'all', title: 'Movie', genres: [], posterStyleKey: 'ember' }],
    movieEnrichments: new Map([['m1', { providerId: 'p', movieId: 'm1', status: 'matched', updatedAt: Date.now(), synopsis: 'An English synopsis.', genres: [] }]]),
  });
  assert.equal(result.items[0].description, 'An English synopsis.');
  assert.equal(result.diagnostics.nonEnglishDescriptionsRejected, 1);
  assert.equal(result.diagnostics.descriptionFallbackSucceeded, 1);
});

test('all unsuitable descriptions are omitted without empty presentation copy', () => {
  const result = enrichNovaPulsePresentation({
    items: [{ id: 'movie-1', type: 'movie', title: 'Movie', sourceItemId: 'm1', priority: 1, description: 'Это фильм', action: { type: 'details', target: '/movies' } }],
    movies: [{ id: 'm1', categoryId: 'all', title: 'Movie', genres: [], posterStyleKey: 'ember' }],
    movieEnrichments: new Map([['m1', { providerId: 'p', movieId: 'm1', status: 'matched', updatedAt: Date.now(), synopsis: 'هذا فيلم', genres: [] }]]),
  });
  assert.equal(result.items[0].description, undefined);
  assert.equal(result.diagnostics.descriptionOmittedForLanguage, 1);
  assert.doesNotMatch(fs.readFileSync(new URL('../src/features/novapulse/NovaPulseCard.tsx', import.meta.url), 'utf8'), /Available in your NovaCast library|Curated for you/);
});

test('provider fallback keeps the language preference for Movie and Series cards', () => {
  const movieEnglish = enrichNovaPulsePresentation({
    items: [{ id: 'movie-en', type: 'movie', title: 'Movie', sourceItemId: 'm-en', priority: 1 }],
    movies: [{ id: 'm-en', categoryId: 'all', title: 'Movie', genres: [], posterStyleKey: 'ember' }],
    movieEnrichments: new Map([['m-en', { providerId: 'p', movieId: 'm-en', status: 'matched', updatedAt: Date.now(), synopsis: 'An English provider synopsis.', genres: [] }]]),
  });
  const movieForeign = enrichNovaPulsePresentation({
    items: [{ id: 'movie-foreign', type: 'movie', title: 'Movie', sourceItemId: 'm-foreign', priority: 1 }],
    movies: [{ id: 'm-foreign', categoryId: 'all', title: 'Movie', genres: [], posterStyleKey: 'ember' }],
    movieEnrichments: new Map([['m-foreign', { providerId: 'p', movieId: 'm-foreign', status: 'matched', updatedAt: Date.now(), synopsis: 'Это фильм без английского описания.' , genres: [] }]]),
  });
  const seriesEnglish = enrichNovaPulsePresentation({
    items: [{ id: 'series-en', type: 'series', title: 'Series', sourceItemId: 's-en', priority: 1 }],
    series: [{ id: 's-en', seriesId: 's-en', title: 'Series', genres: [], posterStyleKey: 'orbit' }],
    seriesDetails: new Map([['s-en', { seriesId: 's-en', title: 'Series', description: 'An English provider overview.', seasons: [], episodesBySeason: {} }]]),
  });
  const seriesForeign = enrichNovaPulsePresentation({
    items: [{ id: 'series-foreign', type: 'series', title: 'Series', sourceItemId: 's-foreign', priority: 1 }],
    series: [{ id: 's-foreign', seriesId: 's-foreign', title: 'Series', genres: [], posterStyleKey: 'orbit' }],
    seriesDetails: new Map([['s-foreign', { seriesId: 's-foreign', title: 'Series', description: 'Это сериал без английского описания.', seasons: [], episodesBySeason: {} }]]),
  });
  const movieUncertain = enrichNovaPulsePresentation({
    items: [{ id: 'movie-uncertain', type: 'movie', title: 'Movie', sourceItemId: 'm-uncertain', priority: 1 }],
    movies: [{ id: 'm-uncertain', categoryId: 'all', title: 'Movie', genres: [], posterStyleKey: 'ember' }],
    movieEnrichments: new Map([['m-uncertain', { providerId: 'p', movieId: 'm-uncertain', status: 'matched', updatedAt: Date.now(), synopsis: 'Café déjà vu — a story with résumé details.', genres: [] }]]),
  });
  const seriesUncertain = enrichNovaPulsePresentation({
    items: [{ id: 'series-uncertain', type: 'series', title: 'Series', sourceItemId: 's-uncertain', priority: 1 }],
    series: [{ id: 's-uncertain', seriesId: 's-uncertain', title: 'Series', genres: [], posterStyleKey: 'orbit' }],
    seriesDetails: new Map([['s-uncertain', { seriesId: 's-uncertain', title: 'Series', description: 'Café déjà vu — an uncertain but Latin-script overview.', seasons: [], episodesBySeason: {} }]]),
  });
  assert.equal(movieEnglish.items[0].description, 'An English provider synopsis.');
  assert.equal(movieForeign.items[0].description, undefined);
  assert.equal(seriesEnglish.items[0].description, 'An English provider overview.');
  assert.equal(seriesForeign.items[0].description, undefined);
  assert.match(movieUncertain.items[0].description, /Café/);
  assert.match(seriesUncertain.items[0].description, /Café/);
});

test('NovaPulse display metadata keeps only validated country codes', () => {
  assert.equal(sanitizeNovaPulseDisplayTitle('The Doll (2026) (PL)'), 'The Doll');
  assert.equal(formatNovaPulseCatalogMeta({ type: 'movie', year: 2026, countryCode: '1923', genres: [], runtimeMinutes: undefined }), '2026');
  assert.equal(formatNovaPulseCatalogMeta({ type: 'series', year: 2026, countryCode: 'PL', genres: [], runtimeMinutes: undefined }), '2026 • PL');
  assert.equal(formatNovaPulseCatalogMeta({ type: 'movie', year: 2026, genres: ['1923'], runtimeMinutes: 96 }), '2026 • 1h 36m');
  assert.equal(formatNovaPulseCatalogMeta({ type: 'movie', year: 2026, genres: ['550e8400-e29b-41d4-a716-446655440000'], runtimeMinutes: 96 }), '2026 • 1h 36m');
  assert.equal(formatNovaPulseCatalogMeta({ type: 'movie', year: 1923, genres: ['Drama'], runtimeMinutes: 96 }), '1923 • Drama • 1h 36m');
});

test('NovaPulse omits implausible runtime placeholders without changing raw catalog data', () => {
  assert.equal(getNovaPulseDisplayRuntimeMinutes(1), undefined);
  assert.equal(formatNovaPulseCatalogMeta({ type: 'movie', year: 2024, genres: [], runtimeMinutes: 1 }), '2024');
  assert.equal(getNovaPulseDisplayRuntimeMinutes(96), 96);
  assert.equal(formatNovaPulseCatalogMeta({ type: 'movie', year: 2024, genres: [], runtimeMinutes: 96 }), '2024 • 1h 36m');
});

test('catalog, sports, announcements, and ranking mechanics remain outside the language helper', () => {
  assert.match(source, /createNovaPulseCatalogSource/);
  assert.match(v2, /qualityScore/);
  assert.match(v2, /selectSports/);
  assert.match(v2, /selectProtected/);
});

test('year normalization rejects malformed, runtime-like, and episode-like values without rejecting explicit historical years', () => {
  const now = new Date(2026, 0, 1);
  assert.equal(normalizeNovaPulseYear(2024, now), 2024);
  assert.equal(normalizeNovaPulseYear('2024-06-01', now), 2024);
  assert.equal(normalizeNovaPulseYear(null, now), undefined);
  assert.equal(normalizeNovaPulseYear('', now), undefined);
  assert.equal(normalizeNovaPulseYear('2024x', now), undefined);
  assert.equal(normalizeNovaPulseYear(1923, now), 1923);
  assert.equal(normalizeNovaPulseYear(120, now), undefined);
  assert.equal(normalizeNovaPulseYear(episodeLikeValue(), now), undefined);
});

function episodeLikeValue() {
  return 3;
}
