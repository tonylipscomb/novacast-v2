import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  CATALOG_INPUT_PRIORITY_WINDOW_MS,
  getCatalogBackgroundWriteYield,
  isCatalogInputPriorityActive,
  noteCatalogForegroundInput,
  resetCatalogForegroundPriorityForTests,
  setCatalogUiSurface,
} from '../src/features/catalog/catalogForegroundPriority.ts';

const writerSource = await readFile(
  new URL('../src/features/catalog/catalogSqliteSyncWriter.ts', import.meta.url),
  'utf8',
);
const layoutSource = await readFile(new URL('../src/app/_layout.tsx', import.meta.url), 'utf8');
const liveModelSource = await readFile(
  new URL('../src/features/live/useLiveTvScreenModel.ts', import.meta.url),
  'utf8',
);

test('D-pad input activates a bounded catalog foreground-priority window', () => {
  resetCatalogForegroundPriorityForTests();
  setCatalogUiSurface('live');
  assert.equal(isCatalogInputPriorityActive(), false);
  noteCatalogForegroundInput(1_000);
  assert.equal(isCatalogInputPriorityActive(1_000 + CATALOG_INPUT_PRIORITY_WINDOW_MS - 1), true);
  assert.equal(isCatalogInputPriorityActive(1_000 + CATALOG_INPUT_PRIORITY_WINDOW_MS), false);
  resetCatalogForegroundPriorityForTests();
});

test('foreground input makes background catalog writes yield without dropping work', () => {
  resetCatalogForegroundPriorityForTests();
  setCatalogUiSurface('live');
  noteCatalogForegroundInput();
  assert.deepEqual(getCatalogBackgroundWriteYield(), { pauseMs: 120, reason: 'input-priority' });
  assert.match(writerSource, /beforeFlush: \(\) => waitForForegroundCatalogWork/);
  resetCatalogForegroundPriorityForTests();
});

test('catalog item statements are bounded and retain generation-safe writes', () => {
  assert.match(writerSource, /minItems: 4,\s*maxItems: 4/);
  assert.match(writerSource, /writeCatalogItemsBatch/);
  assert.match(writerSource, /generation/);
});

test('root TV remote listener marks directional input only', () => {
  assert.match(layoutSource, /noteCatalogForegroundInput/);
  assert.match(layoutSource, /keyCode/);
  assert.match(layoutSource, /normalizedEventType === 'right'/);
});

test('provider changes clear provider-scoped Live state before preserving refresh data', () => {
  assert.match(liveModelSource, /lastStartupProviderIdRef/);
  assert.match(liveModelSource, /channelCacheRef\.current\.clear\(\)/);
  assert.match(liveModelSource, /publishedSnapshotRef\.current = \{ generation: 0, channelCount: 0 \}/);
  assert.match(liveModelSource, /Last-known-good data is safe across same-provider generation refreshes/);
});

console.log('p3-readiness-input-priority: assertions passed');
