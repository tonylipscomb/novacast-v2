import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mergeSeriesCategoryCounts,
  normalizeSeriesCategoryId,
} from '../src/features/series/seriesStartupFastPath.ts';

test('Series count merge treats provider zero as unknown until readable data confirms it', () => {
  const categories = mergeSeriesCategoryCounts(
    [{ id: 'china', name: 'CHINA ANIMATION', count: 0, countKnown: false, kind: 'provider', section: 'provider' }],
    new Map([['china', 25]]),
  );
  assert.deepEqual(
    { count: categories[0].count, countKnown: categories[0].countKnown },
    { count: 25, countKnown: true },
  );
});

test('Series count merge leaves an unhydrated category as an ellipsis state', () => {
  const [category] = mergeSeriesCategoryCounts(
    [{ id: 'empty', name: 'Empty', count: 0, countKnown: false, kind: 'provider', section: 'provider' }],
    new Map(),
  );
  assert.equal(category.countKnown, false);
  assert.equal(category.count, 0);
});

test('Series count merge preserves a confirmed readable zero', () => {
  const [category] = mergeSeriesCategoryCounts(
    [{ id: 'empty', name: 'Empty', count: 0, countKnown: false, kind: 'provider', section: 'provider' }],
    new Map([['empty', 0]]),
  );
  assert.deepEqual({ count: category.count, countKnown: category.countKnown }, { count: 0, countKnown: true });
});

test('Series category count IDs are normalized at the lookup boundary', () => {
  assert.equal(normalizeSeriesCategoryId(42), '42');
  const [category] = mergeSeriesCategoryCounts(
    [{ id: '42', name: 'Numeric', count: 0, countKnown: false, kind: 'provider', section: 'provider' }],
    new Map([[normalizeSeriesCategoryId(42), 7]]),
  );
  assert.deepEqual({ count: category.count, countKnown: category.countKnown }, { count: 7, countKnown: true });
});
