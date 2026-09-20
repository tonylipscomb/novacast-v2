import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  getNovaPulseLanguageEvidence,
  isNovaPulseEnglishDescription,
  preferNovaPulseEnglishVariants,
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

test('catalog, sports, announcements, and ranking mechanics remain outside the language helper', () => {
  assert.match(source, /createNovaPulseCatalogSource/);
  assert.match(v2, /qualityScore/);
  assert.match(v2, /selectSports/);
  assert.match(v2, /selectProtected/);
});
