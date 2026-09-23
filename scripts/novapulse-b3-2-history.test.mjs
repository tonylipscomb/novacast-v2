import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getCachedNovaPulseHistory,
  createNovaPulseHistoryWriteGate,
  hasCachedNovaPulseHistory,
  loadNovaPulseHistory,
  novaPulseHistoryPenalty,
  providerFingerprint,
  recordNovaPulseSelection,
  setNovaPulseHistoryStorageForTests,
} from '../src/features/novapulse/novaPulseHistory.ts';
import { composeNovaPulseFeedV2 } from '../src/features/novapulse/novaPulseV2.ts';

const NOW = Date.parse('2026-09-22T12:00:00Z');
const HOUR = 60 * 60_000;

function source(items) {
  return { id: 'history-test', getItems: () => ({ sourceId: 'history-test', items }) };
}

function catalogItem(id, type = 'movie') {
  return {
    id: `${type}-${id}`,
    type,
    title: `${type} ${id}`,
    sourceId: `catalog-${type}`,
    sourceItemId: id,
    priority: 1,
    artworkUrl: `https://art.example/${type}/${id}.jpg`,
    action: { type: 'details', contentId: id },
  };
}

function memoryStorage(initial = null, { failRead = false, failWrite = false, readDelayMs = 0 } = {}) {
  let value = initial;
  let writes = 0;
  return {
    get writes() { return writes; },
    async getItem() {
      if (failRead) throw new Error('read failed');
      if (readDelayMs) await new Promise((resolve) => setTimeout(resolve, readDelayMs));
      return value;
    },
    async setItem(_key, next) {
      if (failWrite) throw new Error('write failed');
      writes += 1;
      value = next;
    },
    raw() { return value; },
  };
}

test.afterEach(() => setNovaPulseHistoryStorageForTests(null));

test('recent Movie and Series receive penalties when alternatives exist', () => {
  const recent = [
    { mediaType: 'movie', contentId: 'm1', lastSelectedAt: NOW - HOUR },
    { mediaType: 'series', contentId: 's1', lastSelectedAt: NOW - HOUR },
  ];
  const movie = composeNovaPulseFeedV2([source([catalogItem('m1'), catalogItem('m2')])], { seed: 'history', nowMs: NOW, recentHistory: recent });
  const series = composeNovaPulseFeedV2([source([catalogItem('s1', 'series'), catalogItem('s2', 'series')])], { seed: 'history', nowMs: NOW, recentHistory: recent });
  assert.equal(movie.items[0].sourceItemId, 'm2');
  assert.equal(series.items[0].sourceItemId, 's2');
});

test('quality remains ahead of unusable content when a usable item is recent', () => {
  const result = composeNovaPulseFeedV2([source([
    { ...catalogItem('recent'), description: 'usable description', rating: 8 },
    { id: 'unusable', type: 'movie', title: '', sourceId: 'catalog-movie', sourceItemId: 'unusable', priority: 0 },
  ])], {
    seed: 'quality',
    nowMs: NOW,
    recentHistory: [{ mediaType: 'movie', contentId: 'recent', lastSelectedAt: NOW - HOUR }],
  });
  assert.equal(result.items[0].sourceItemId, 'recent');
});

test('sparse catalogs may reuse a recent item', () => {
  const result = composeNovaPulseFeedV2([source([catalogItem('only')])], {
    seed: 'sparse',
    nowMs: NOW,
    recentHistory: [{ mediaType: 'movie', contentId: 'only', lastSelectedAt: NOW - HOUR }],
  });
  assert.equal(result.items[0].sourceItemId, 'only');
});

test('penalties decay at 24-hour, 72-hour, and 7-day boundaries', () => {
  assert.equal(novaPulseHistoryPenalty({ mediaType: 'movie', contentId: 'm', lastSelectedAt: NOW - (24 * HOUR - 1) }, NOW), -30);
  assert.equal(novaPulseHistoryPenalty({ mediaType: 'movie', contentId: 'm', lastSelectedAt: NOW - (24 * HOUR) }, NOW), -12);
  assert.equal(novaPulseHistoryPenalty({ mediaType: 'movie', contentId: 'm', lastSelectedAt: NOW - (72 * HOUR) }, NOW), -3);
  assert.equal(novaPulseHistoryPenalty({ mediaType: 'movie', contentId: 'm', lastSelectedAt: NOW - (7 * 24 * HOUR) }, NOW), 0);
});

test('history removes expired entries, deduplicates, and bounds each provider to 96 entries', async () => {
  const entries = Array.from({ length: 100 }, (_, index) => ({ mediaType: 'movie', contentId: `m${index}`, lastSelectedAt: NOW - index * 1_000 }));
  entries.push({ mediaType: 'series', contentId: 'expired', lastSelectedAt: NOW - 7 * 24 * HOUR });
  entries.push({ mediaType: 'movie', contentId: 'm1', lastSelectedAt: NOW - 500 });
  const storage = memoryStorage(JSON.stringify({ schemaVersion: 1, providers: { [providerFingerprint('p1')]: { providerFingerprint: providerFingerprint('p1'), entries } } }));
  setNovaPulseHistoryStorageForTests(storage);
  const result = await loadNovaPulseHistory('p1', NOW);
  assert.equal(result.entries.length, 96);
  assert.equal(result.expiredRemoved, 1);
  assert.equal(result.entries.filter((entry) => entry.contentId === 'm1').length, 1);
});

test('providers and media types remain isolated even when raw IDs collide', async () => {
  const storage = memoryStorage();
  setNovaPulseHistoryStorageForTests(storage);
  await recordNovaPulseSelection('provider-a', [catalogItem('42', 'movie')], NOW);
  await recordNovaPulseSelection('provider-b', [catalogItem('42', 'series')], NOW);
  const a = await loadNovaPulseHistory('provider-a', NOW);
  const b = await loadNovaPulseHistory('provider-b', NOW);
  assert.deepEqual(a.entries.map(({ mediaType, contentId }) => ({ mediaType, contentId })), [{ mediaType: 'movie', contentId: '42' }]);
  assert.deepEqual(b.entries.map(({ mediaType, contentId }) => ({ mediaType, contentId })), [{ mediaType: 'series', contentId: '42' }]);
});

test('first-session writes influence a later Home session while caps and protected sources remain intact', async () => {
  const storage = memoryStorage();
  setNovaPulseHistoryStorageForTests(storage);
  const items = [
    ...Array.from({ length: 8 }, (_, index) => catalogItem(`m${index + 1}`)),
    ...Array.from({ length: 8 }, (_, index) => catalogItem(`s${index + 1}`, 'series')),
    { id: 'sport-1', type: 'sports', subtype: 'upcoming', title: 'sport', startsAt: new Date(NOW + HOUR).toISOString(), priority: 1 },
    { id: 'announcement-1', type: 'announcement', title: 'announcement', priority: 1 },
  ];
  const first = composeNovaPulseFeedV2([source(items)], { seed: 'session', nowMs: NOW });
  await recordNovaPulseSelection('provider', first.items, NOW);
  const secondSnapshot = getCachedNovaPulseHistory('provider');
  const second = composeNovaPulseFeedV2([source(items)], { seed: 'session', nowMs: NOW, recentHistory: secondSnapshot });
  const firstCatalogIds = new Set(first.items.filter((item) => item.type === 'movie' || item.type === 'series').map((item) => `${item.type}:${item.sourceItemId}`));
  const secondCatalogIds = new Set(second.items.filter((item) => item.type === 'movie' || item.type === 'series').map((item) => `${item.type}:${item.sourceItemId}`));
  assert.notDeepEqual([...secondCatalogIds].sort(), [...firstCatalogIds].sort());
  assert.ok(second.items.some((item) => item.type === 'sports'));
  assert.ok(second.items.some((item) => item.type === 'announcement'));
  assert.ok(second.items.filter((item) => item.type === 'sports').length <= 2);
  assert.ok(second.items.length <= 12);
  assert.ok(second.items.some((item) => item.type === 'movie'));
  assert.ok(second.items.some((item) => item.type === 'series'));
});

test('corrupt and unsupported payloads are treated as empty history', async () => {
  for (const raw of ['not-json', JSON.stringify({ schemaVersion: 99, providers: {} }), JSON.stringify({ schemaVersion: 1, providers: { bad: { entries: [{}] } } })]) {
    const storage = memoryStorage(raw);
    setNovaPulseHistoryStorageForTests(storage);
    const result = await loadNovaPulseHistory('provider', NOW);
    assert.deepEqual(result.entries, []);
  }
});

test('storage read and write failures are non-fatal', async () => {
  const readFailure = memoryStorage(null, { failRead: true });
  setNovaPulseHistoryStorageForTests(readFailure);
  assert.equal((await loadNovaPulseHistory('provider', NOW)).storageFailed, true);

  const writeFailure = memoryStorage(null, { failWrite: true });
  setNovaPulseHistoryStorageForTests(writeFailure);
  const result = await recordNovaPulseSelection('provider', [catalogItem('m1')], NOW);
  assert.equal(result.success, false);
  assert.equal(getCachedNovaPulseHistory('provider').length, 1);
});

test('delayed hydration cannot reorder the visible session but is used by the next session', async () => {
  const provider = 'delayed-provider';
  const seeded = JSON.stringify({ schemaVersion: 1, providers: { [providerFingerprint(provider)]: {
    providerFingerprint: providerFingerprint(provider),
    entries: [{ mediaType: 'movie', contentId: 'm1', lastSelectedAt: NOW - HOUR }],
  } } });
  const storage = memoryStorage(seeded, { readDelayMs: 20 });
  setNovaPulseHistoryStorageForTests(storage);
  const items = [catalogItem('m1'), catalogItem('m2'), catalogItem('m3')];
  const visibleBeforeHydration = composeNovaPulseFeedV2([source(items)], { seed: 'delayed', nowMs: NOW, recentHistory: getCachedNovaPulseHistory(provider) });
  const loading = loadNovaPulseHistory(provider, NOW);
  assert.deepEqual(getCachedNovaPulseHistory(provider), []);
  const hydrated = await loading;
  assert.equal(hydrated.entries.length, 1);
  const nextSession = composeNovaPulseFeedV2([source(items)], { seed: 'delayed', nowMs: NOW, recentHistory: getCachedNovaPulseHistory(provider) });
  assert.notDeepEqual(nextSession.items.map((item) => item.sourceItemId), visibleBeforeHydration.items.map((item) => item.sourceItemId));
  assert.equal(visibleBeforeHydration.items[0].sourceItemId, 'm1');
  assert.notEqual(nextSession.items[0].sourceItemId, 'm1');
});

test('history loaded before a new session is available synchronously to that session', async () => {
  const provider = 'immediate-provider';
  const storage = memoryStorage(JSON.stringify({ schemaVersion: 1, providers: { [providerFingerprint(provider)]: {
    providerFingerprint: providerFingerprint(provider),
    entries: [{ mediaType: 'movie', contentId: 'm1', lastSelectedAt: NOW - HOUR }],
  } } }));
  setNovaPulseHistoryStorageForTests(storage);
  await loadNovaPulseHistory(provider, NOW);
  assert.equal(hasCachedNovaPulseHistory(provider), true);
  const result = composeNovaPulseFeedV2([source([catalogItem('m1'), catalogItem('m2')])], {
    seed: 'immediate',
    nowMs: NOW,
    recentHistory: getCachedNovaPulseHistory(provider),
  });
  assert.equal(result.items[0].sourceItemId, 'm2');
});

test('failed hydration leaves the visible session usable and does not reorder it', async () => {
  const storage = memoryStorage(null, { failRead: true });
  setNovaPulseHistoryStorageForTests(storage);
  const items = [catalogItem('m1'), catalogItem('m2')];
  const before = composeNovaPulseFeedV2([source(items)], { seed: 'failed', nowMs: NOW, recentHistory: getCachedNovaPulseHistory('failed-provider') });
  const result = await loadNovaPulseHistory('failed-provider', NOW);
  const after = composeNovaPulseFeedV2([source(items)], { seed: 'failed', nowMs: NOW, recentHistory: [] });
  assert.equal(result.storageFailed, true);
  assert.deepEqual(after.items.map((item) => item.sourceItemId), before.items.map((item) => item.sourceItemId));
});

test('duplicate selection updates its timestamp and merges providers without erasing either bucket', async () => {
  const storage = memoryStorage();
  setNovaPulseHistoryStorageForTests(storage);
  await recordNovaPulseSelection('provider-a', [catalogItem('m1')], NOW - HOUR);
  await recordNovaPulseSelection('provider-b', [catalogItem('m2')], NOW - HOUR);
  await recordNovaPulseSelection('provider-a', [catalogItem('m1')], NOW);
  const a = await loadNovaPulseHistory('provider-a', NOW);
  const b = await loadNovaPulseHistory('provider-b', NOW);
  assert.deepEqual(a.entries, [{ mediaType: 'movie', contentId: 'm1', lastSelectedAt: NOW }]);
  assert.deepEqual(b.entries, [{ mediaType: 'movie', contentId: 'm2', lastSelectedAt: NOW - HOUR }]);
});

test('stored history contains no titles, descriptions, artwork, URLs, or playback fields', async () => {
  const storage = memoryStorage();
  setNovaPulseHistoryStorageForTests(storage);
  await recordNovaPulseSelection('provider', [{ ...catalogItem('m1'), description: 'private plot', action: { type: 'play', target: 'https://stream.example' } }], NOW);
  const raw = storage.raw();
  assert.ok(raw);
  assert.equal(raw.includes('private plot'), false);
  assert.equal(raw.includes('art.example'), false);
  assert.equal(raw.includes('stream.example'), false);
  assert.equal(raw.includes('provider-id-secret'), false);
  assert.deepEqual(Object.keys(JSON.parse(raw).providers[providerFingerprint('provider')].entries[0]).sort(), ['contentId', 'lastSelectedAt', 'mediaType']);
});

test('selected identities are admitted to storage only once per composition session', () => {
  const shouldWrite = createNovaPulseHistoryWriteGate();
  assert.equal(shouldWrite(), true);
  assert.equal(shouldWrite(), false);
});

test('a fixed history snapshot keeps composition order stable after late hydration', () => {
  const items = [catalogItem('m1'), catalogItem('m2'), catalogItem('m3')];
  const emptySnapshot = composeNovaPulseFeedV2([source(items)], { seed: 'session', nowMs: NOW, recentHistory: [] });
  const hydratedLater = composeNovaPulseFeedV2([source(items)], { seed: 'session', nowMs: NOW, recentHistory: [] });
  assert.deepEqual(hydratedLater.items.map((item) => item.sourceItemId), emptySnapshot.items.map((item) => item.sourceItemId));
});
