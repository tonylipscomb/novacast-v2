import assert from 'node:assert/strict';
import test from 'node:test';

import {
  categoryTypeAccentColor,
  categoryTypeLabel,
  classifyProviderCategoryType,
} from '../src/features/providers/categoryNormalization.ts';

test('classifies well-known category keywords regardless of surrounding text', () => {
  assert.equal(classifyProviderCategoryType('USA News'), 'news');
  assert.equal(classifyProviderCategoryType('USA Sports'), 'sports');
  assert.equal(classifyProviderCategoryType('Movie Channels'), 'movies');
  assert.equal(classifyProviderCategoryType('Kids & Family'), 'kids');
  assert.equal(classifyProviderCategoryType('Music Videos'), 'music');
  assert.equal(classifyProviderCategoryType('International'), 'international');
});

test('is case-insensitive and falls back to general for unrecognized categories', () => {
  assert.equal(classifyProviderCategoryType('uk NEWS'), 'news');
  assert.equal(classifyProviderCategoryType('Local Sports Network'), 'sports');
  assert.equal(classifyProviderCategoryType('USA Entertainment'), 'general');
  assert.equal(classifyProviderCategoryType(''), 'general');
});

test('every category type resolves to a distinct, well-formed accent color', () => {
  const types = ['news', 'sports', 'movies', 'kids', 'music', 'international', 'general'];
  const colors = types.map((type) => categoryTypeAccentColor(type));

  colors.forEach((color) => assert.match(color, /^#[0-9A-Fa-f]{6}$/));
  assert.equal(categoryTypeAccentColor('international'), categoryTypeAccentColor('general'));

  const distinctColors = new Set(colors.filter((_, index) => types[index] !== 'international'));
  assert.equal(distinctColors.size, types.length - 1);
});

test('category type labels are human readable', () => {
  assert.equal(categoryTypeLabel('news'), 'News');
  assert.equal(categoryTypeLabel('sports'), 'Sports');
  assert.equal(categoryTypeLabel('movies'), 'Movies');
  assert.equal(categoryTypeLabel('kids'), 'Kids & Family');
  assert.equal(categoryTypeLabel('music'), 'Music');
  assert.equal(categoryTypeLabel('general'), 'Entertainment');
});
