import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NOVA_PULSE_LIVE_CANDIDATE_LIMIT,
  NOVA_PULSE_LIVE_EPG_CONCURRENCY,
  NOVA_PULSE_LIVE_EPG_LIMIT,
  NOVA_PULSE_LIVE_EPG_TTL_MS,
  resetNovaPulseLiveEpgCache,
  runNovaPulseLiveEpgCycle,
} from '../src/features/novapulse/novaPulseLiveEpg.ts';

const now = Date.parse('2026-09-20T20:00:00Z');

function entry(id) {
  return { id, providerId: 'provider-a', categoryId: 'news', name: `Channel ${id}`, number: Number(id.replace(/\D/g, '')) || 1, normalizedName: id, normalizedCurrent: '', normalizedCategory: 'news', numberText: '1', nameTokens: [], currentTokens: [] };
}

function program(id, startAt, endAt, overrides = {}) {
  return { id, title: `Program ${id}`, meta: '', startAt, endAt, ...overrides };
}

function input(overrides = {}) {
  const entries = new Map(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => [id, entry(id)]));
  return {
    providerId: 'provider-a',
    favoriteChannels: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
    recentItems: [{ providerId: 'provider-a', mediaType: 'live', contentId: 'b', title: 'B', lastOpenedAt: 20 }, { providerId: 'provider-a', mediaType: 'live', contentId: 'c', title: 'C', lastOpenedAt: 10 }],
    getIndexEntry: (id) => entries.get(id),
    getShortEpg: async (id) => [program(id, now - 10 * 60_000, now + 30 * 60_000)],
    nowMs: now,
    ...overrides,
  };
}

test('B1 candidate resolution dedupes favorite/recent channels and skips unresolved ids', async () => {
  resetNovaPulseLiveEpgCache();
  const result = await runNovaPulseLiveEpgCycle(input({
    favoriteChannels: Array.from({ length: 8 }, (_, index) => ({ id: String.fromCharCode(97 + index), title: 'Channel' })),
    recentItems: [{ providerId: 'provider-a', mediaType: 'live', contentId: 'b', title: 'B', lastOpenedAt: 999 }, { providerId: 'provider-a', mediaType: 'live', contentId: 'missing', title: 'Missing', lastOpenedAt: 1000 }],
  }));
  assert.equal(NOVA_PULSE_LIVE_CANDIDATE_LIMIT, 6);
  assert.equal(result.diagnostics.candidateChannels, 6);
  assert.equal(result.diagnostics.resolvedChannels, 6);
});

test('B1 resolves provider-scoped personalization when the Live index is empty', async () => {
  resetNovaPulseLiveEpgCache();
  let requestedId = '';
  const result = await runNovaPulseLiveEpgCycle(input({
    favoriteChannels: [{ providerId: 'provider-a', id: '12345', streamId: '12345', title: 'Saved Channel' }],
    recentItems: [{ providerId: 'provider-a', mediaType: 'live', contentId: 'live:12345', title: 'Saved Channel', lastOpenedAt: 20 }],
    getIndexEntry: () => undefined,
    getIndexSize: () => 0,
    getShortEpg: async (id) => { requestedId = id; return [program('saved', now - 1, now + 60_000)]; },
  }));
  assert.equal(result.diagnostics.candidateChannels, 1);
  assert.equal(result.diagnostics.resolvedChannels, 1);
  assert.equal(result.diagnostics.resolvedFromPersonalization, 1);
  assert.equal(result.diagnostics.indexNotReady, 1);
  assert.equal(result.diagnostics.epgRequestsStarted, 1);
  assert.equal(requestedId, '12345');
  assert.equal(result.items[0].action.contentId, '12345');
});

test('B1 rejects stale-provider personalization and never scans the provider catalog', async () => {
  resetNovaPulseLiveEpgCache();
  let requests = 0;
  const result = await runNovaPulseLiveEpgCycle(input({
    favoriteChannels: [{ providerId: 'old-provider', id: 'old', title: 'Old' }],
    recentItems: [{ providerId: 'old-provider', mediaType: 'live', contentId: 'old', title: 'Old', lastOpenedAt: 20 }],
    getIndexEntry: () => undefined,
    getShortEpg: async () => { requests += 1; return []; },
  }));
  assert.equal(result.diagnostics.candidateChannels, 0);
  assert.equal(result.diagnostics.providerMismatches, 2);
  assert.equal(result.diagnostics.epgRequestsStarted, 0);
  assert.equal(requests, 0);
});

test('B1 timing chooses ON NOW, UP NEXT, TONIGHT, and rejects expired programs', async () => {
  resetNovaPulseLiveEpgCache();
  const result = await runNovaPulseLiveEpgCycle(input({
    favoriteChannels: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }, { id: 'd', title: 'D' }],
    recentItems: [],
    getShortEpg: async (id) => id === 'a'
      ? [program('now', now - 1, now + 1000), program('next', now + 5 * 60_000, now + 6 * 60_000)]
      : id === 'b'
        ? [program('next', now + 30 * 60_000, now + 60 * 60_000)]
        : id === 'c'
          ? [program('tonight', now + 3 * 60 * 60_000, now + 4 * 60 * 60_000)]
          : [program('expired', now - 3 * 60 * 60_000, now - 2 * 60 * 60_000)],
  }));
  assert.deepEqual(result.items.map((item) => item.timingReason), ['on_now', 'up_next']);
  assert.equal(result.diagnostics.onNowCandidates, 1);
  assert.equal(result.diagnostics.upNextCandidates, 1);
  assert.equal(result.diagnostics.tonightCandidates, 1);
});

test('B1 bounds requests, concurrency, cards, and EPG rows', async () => {
  resetNovaPulseLiveEpgCache();
  let active = 0;
  let maxActive = 0;
  let requests = 0;
  const result = await runNovaPulseLiveEpgCycle(input({
    favoriteChannels: Array.from({ length: 6 }, (_, index) => ({ id: String.fromCharCode(97 + index), title: 'Channel' })),
    recentItems: [],
    getShortEpg: async () => {
      requests += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return Array.from({ length: 5 }, (_, index) => program(String(index), now - 1, now + 60_000));
    },
  }));
  assert.equal(NOVA_PULSE_LIVE_EPG_LIMIT, 3);
  assert.equal(NOVA_PULSE_LIVE_EPG_CONCURRENCY, 2);
  assert.equal(requests, 6);
  assert.equal(maxActive, 2);
  assert.equal(result.items.length, 2);
});

test('B1 uses stable direct-tune channel identity and provider-scoped five-minute cache', async () => {
  resetNovaPulseLiveEpgCache();
  let requests = 0;
  const first = await runNovaPulseLiveEpgCycle(input({ getShortEpg: async () => { requests += 1; return [program('one', now - 1, now + 60_000)]; } }));
  const second = await runNovaPulseLiveEpgCycle(input({ getShortEpg: async () => { requests += 1; return [program('two', now - 1, now + 60_000)]; } }));
  assert.equal(requests, 3);
  assert.equal(first.items[0].action.type, 'channel');
  assert.equal(first.items[0].action.target, '/live');
  assert.equal(first.items[0].action.contentId, 'b');
  assert.equal(NOVA_PULSE_LIVE_EPG_TTL_MS, 300000);
  assert.equal(second.items[0].id, first.items[0].id);
});

test('B1 omits unsuitable program descriptions without removing the card', async () => {
  resetNovaPulseLiveEpgCache();
  const result = await runNovaPulseLiveEpgCycle(input({ getShortEpg: async () => [program('language', now - 1, now + 60_000, { description: '\u0647\u0630\u0627 \u0641\u064a\u0644\u0645' })] }));
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].description, undefined);
  assert.equal(result.diagnostics.nonEnglishDescriptionsOmitted, 3);
  assert.doesNotMatch(result.items[0].title, /NEW EPISODE/i);
});

test('B1 normalizes provider timestamp strings and seconds at the NovaPulse boundary', async () => {
  resetNovaPulseLiveEpgCache();
  const result = await runNovaPulseLiveEpgCycle(input({
    getShortEpg: async () => [{
      id: 'string-window',
      title: 'String Window',
      meta: '',
      start: String((now - 60_000) / 1000),
      end: String((now + 60_000) / 1000),
      epgSource: 'provider',
    }],
  }));
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].title, 'String Window');
  assert.equal(result.diagnostics.epgRowsReturned, 3);
  assert.equal(result.diagnostics.epgRowsNormalized, 3);
  assert.equal(result.diagnostics.rowsWithStartString, 3);
  assert.equal(result.diagnostics.rowsWithEndString, 3);
  assert.equal(result.diagnostics.providerEpgHits, 3);
  assert.equal(result.diagnostics.invalidTimestampRows, 0);
});

test('B1 exposes bounded payload diagnostics for empty, invalid, expired, and future rows', async () => {
  resetNovaPulseLiveEpgCache();
  const result = await runNovaPulseLiveEpgCycle(input({
    favoriteChannels: [{ id: 'a', title: 'A' }],
    recentItems: [],
    getShortEpg: async () => [
      program('expired', now - 120_000, now - 60_000),
      program('future', now + 10 * 60 * 60_000, now + 11 * 60 * 60_000),
      { id: 'invalid', title: 'Invalid', meta: '', start: 'not-a-time', end: 'also-not-a-time' },
    ],
  }));
  assert.equal(result.items.length, 0);
  assert.equal(result.diagnostics.epgRowsReturned, 3);
  assert.equal(result.diagnostics.expiredRowsRejected, 1);
  assert.equal(result.diagnostics.futureRowsSeen, 1);
  assert.equal(result.diagnostics.invalidTimestampRows, 1);
  assert.equal(result.diagnostics.classificationRejectedRows, 1);
  assert.equal(result.diagnostics.emptyEpgResponses, 0);
});

test('B1 counts empty EPG responses without creating a card', async () => {
  resetNovaPulseLiveEpgCache();
  const result = await runNovaPulseLiveEpgCycle(input({
    favoriteChannels: [{ id: 'a', title: 'A' }],
    recentItems: [],
    getShortEpg: async () => [],
  }));
  assert.equal(result.items.length, 0);
  assert.equal(result.diagnostics.epgRowsReturned, 0);
  assert.equal(result.diagnostics.emptyEpgResponses, 1);
});
