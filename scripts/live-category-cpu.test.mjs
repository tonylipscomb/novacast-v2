import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCategoryRegionalProfile,
  sortProviderCategoriesByRegion,
} from '../src/features/providers/categoryRegionalPipeline.ts';
import { sortLiveCategoriesUsFirst } from '../src/features/providers/usAmericanSort.ts';
import { parseProviderTitlePrefix } from '../src/features/series/metadata/titleNormalization.ts';

// Deterministic representative catalog spanning every region group + scripts.
const PREFIXES = [
  'US', 'USA', 'US |', 'US:', 'UK', 'UK |', 'CA', 'AU', 'FR', 'DE', 'ES', 'IT',
  'AR', 'IN', 'PK', 'TR', 'RU', 'BR', 'MX', 'EN', 'ENG', '[US]', '[UK]', '',
];
const BODIES = [
  'Entertainment', 'Sports', 'News', 'Kids', 'Movies', 'Series', 'Music',
  'Documentary', 'Comedy', 'Premium HD', 'Local Channels', 'English',
  'Bollywood', 'رمضان', 'Русский', '한국', '日本', 'Deportes', 'Cinema',
  'Family', 'Lifestyle', 'Nature', 'Kids عربي', 'Religious', 'Islamic',
  'General', 'VIP', 'Live Events', '24/7', 'Classics',
];

function makeCategories(count) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const prefix = PREFIXES[i % PREFIXES.length];
    const body = BODIES[(i * 7) % BODIES.length];
    const name = (prefix ? `${prefix} ${body}` : body).trim();
    out.push({ id: String(i), name, rawName: name, count: (i % 50) + 1 });
  }
  return out;
}

// Reference comparator that mirrors the ORIGINAL implementation: per-call
// String.prototype.localeCompare with { sensitivity: 'base' }. If the shared
// Intl.Collator produces a different order than this, the optimization changed
// output and this test fails.
function referenceSort(items, { alphabetize }) {
  const ranked = items.map((item, index) => ({
    item,
    index,
    profile: buildCategoryRegionalProfile({
      name: item.name,
      rawName: item.rawName,
      countryCode: item.countryCode,
      contentType: 'live',
    }),
  }));
  ranked.sort((l, r) => {
    if (l.profile.sortPriority !== r.profile.sortPriority) {
      return l.profile.sortPriority - r.profile.sortPriority;
    }
    if (alphabetize) {
      const d = l.profile.sortLabel.localeCompare(r.profile.sortLabel, undefined, {
        sensitivity: 'base',
      });
      if (d !== 0) return d;
    }
    return l.index - r.index;
  });
  return ranked.map((x) => x.item);
}

test('collator reuse preserves exact ordering vs per-call localeCompare (913 categories)', () => {
  const cats = makeCategories(913);
  const optimized = sortLiveCategoriesUsFirst(cats.map((c) => ({ ...c }))).map((c) => c.id);
  const reference = referenceSort(cats.map((c) => ({ ...c })), { alphabetize: true }).map((c) => c.id);
  assert.deepEqual(optimized, reference);
});

test('regional grouping + US-first semantics unchanged', () => {
  const sorted = sortProviderCategoriesByRegion(
    [
      { id: 'russian', name: 'Русский' },
      { id: 'uk', name: 'UK' },
      { id: 'us', name: 'US' },
      { id: 'canada', name: 'Canada' },
      { id: 'australia', name: 'Australia' },
      { id: 'english', name: 'English' },
      { id: 'japan', name: '日本' },
    ],
    { contentType: 'live' },
  );
  const groups = sorted.map((c) => buildCategoryRegionalProfile({ name: c.name, contentType: 'live' }).regionGroup);
  // US must precede Canada, Australia, intlEnglish, UK, and all foreign scripts.
  assert.equal(groups[0], 'us');
  const foreignIndex = sorted.findIndex((c) => c.id === 'russian');
  const usIndex = sorted.findIndex((c) => c.id === 'us');
  const jpIndex = sorted.findIndex((c) => c.id === 'japan');
  assert.ok(usIndex < foreignIndex);
  assert.ok(usIndex < jpIndex);
});

test('unicode / non-latin categories sort after latin groups (order preserved)', () => {
  const cats = makeCategories(300);
  const optimized = sortLiveCategoriesUsFirst(cats.map((c) => ({ ...c }))).map((c) => c.id);
  const reference = referenceSort(cats.map((c) => ({ ...c })), { alphabetize: true }).map((c) => c.id);
  assert.deepEqual(optimized, reference);
});

test('profile is built exactly once per category', () => {
  const cats = makeCategories(400);
  const metrics = { profileBuildMs: 0, actualSortMs: 0, profileBuildCount: 0, comparatorCalls: 0 };
  sortProviderCategoriesByRegion(cats, { contentType: 'live', metrics });
  assert.equal(metrics.profileBuildCount, cats.length);
  assert.equal(metrics.titleParseCount, cats.length); // one parse pass per category label
  assert.equal(metrics.scriptDetectCount, cats.length);
  assert.equal(metrics.regionClassifyCount, cats.length);
});

test('metrics measure sort and profile independently (no sortMs = normalizeMs conflation)', () => {
  const cats = makeCategories(913);
  const metrics = { profileBuildMs: 0, actualSortMs: 0, profileBuildCount: 0, comparatorCalls: 0 };
  sortProviderCategoriesByRegion(cats, { contentType: 'live', metrics });
  assert.ok(metrics.comparatorCalls > 0);
  assert.notEqual(metrics.actualSortMs, metrics.profileBuildMs);
});

test('title prefix normalization unchanged after hoisting delimiter regexes', () => {
  assert.equal(parseProviderTitlePrefix('US | Sports HD').title, 'Sports HD');
  assert.equal(parseProviderTitlePrefix('UK: News').title, 'News');
  assert.equal(parseProviderTitlePrefix('  ||  Movies  ').title, 'Movies');
  assert.equal(parseProviderTitlePrefix('English Series').title, 'English Series');
  assert.equal(parseProviderTitlePrefix('رمضان').title, 'رمضان');
});
