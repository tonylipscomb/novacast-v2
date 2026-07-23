import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatCategoryCountLabel,
  formatLibraryTotal,
  shouldShowCachedTotals,
} from '../src/features/hub/librarySummaryFormat.ts';

test('formatLibraryTotal hides empty totals on the hub', () => {
  assert.equal(formatLibraryTotal(0, 'titles'), null);
  assert.equal(formatLibraryTotal(0, 'channels'), null);
});

test('formatLibraryTotal formats synced totals', () => {
  assert.equal(formatLibraryTotal(32482, 'titles'), '32,482 Titles');
  assert.equal(formatLibraryTotal(18233, 'channels'), '18,233 Channels');
});

test('formatCategoryCountLabel renders Smarters-style sidebar labels', () => {
  assert.equal(formatCategoryCountLabel('Action', 3218), 'Action (3,218)');
  assert.equal(formatCategoryCountLabel('Discover', 0), 'Discover');
});

test('shouldShowCachedTotals reflects persisted sync state', () => {
  assert.equal(shouldShowCachedTotals(0), false);
  assert.equal(shouldShowCachedTotals(Date.now()), true);
});
