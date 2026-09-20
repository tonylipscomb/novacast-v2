import assert from 'node:assert/strict';
import test from 'node:test';

import { createRecommendationBehaviorTracker } from '../src/features/novapulse/recommendationBehavior.ts';
import {
  ackRecommendationEvents,
  enqueueRecommendationEvent,
  listPendingRecommendationEvents,
  resetRecommendationQueueForTests,
  setRecommendationStorageForTests,
  RECOMMENDATION_QUEUE_MAX_EVENTS,
} from '../src/features/novapulse/recommendationEventQueue.ts';
import { flushRecommendationEvents, resetRecommendationSyncForTests } from '../src/features/novapulse/recommendationEventSync.ts';
import { createRecommendationEvent } from '../src/features/novapulse/recommendationContract.ts';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
  };
}

function movieContext() {
  return { providerId: 'provider-a', contentId: 'movie-1', contentType: 'movie', title: 'Example Movie', year: 2024 };
}

function event(index, eventType = 'play_start') {
  return createRecommendationEvent({
    eventType,
    contentType: 'movie',
    fingerprint: `movie|example-${index}|2024`,
    providerId: 'provider-a',
    providerContentId: `movie-${index}`,
    sessionId: `session-${index}`,
    occurredAt: '2026-09-20T00:00:00.000Z',
  });
}

test('play_start is one-shot and forced playback retry does not duplicate it', async () => {
  const events = [];
  const tracker = createRecommendationBehaviorTracker(async (value) => { events.push(value); return true; }, () => 1);
  assert.ok(tracker.begin(movieContext(), 'playback-session', false));
  tracker.begin(movieContext(), 'retry-session', true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events.map((value) => value.eventType), ['play_start']);
});

test('meaningful watch and complete each emit once, including stop after progress', async () => {
  const events = [];
  const tracker = createRecommendationBehaviorTracker(async (value) => { events.push(value); return true; }, () => 1);
  tracker.begin(movieContext(), 'session-a');
  tracker.started('session-a');
  tracker.progress('session-a', 5 * 60_000, 30 * 60_000);
  tracker.progress('session-a', 552_000, 600_000);
  tracker.progress('session-a', 552_000, 600_000);
  tracker.stop('session-a', 552_000, 600_000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events.map((value) => value.eventType), ['play_start', 'meaningful_watch', 'complete']);
});

test('failure before first frame does not classify abandonment', async () => {
  const events = [];
  const tracker = createRecommendationBehaviorTracker(async (value) => { events.push(value); return true; }, () => 1);
  tracker.begin(movieContext(), 'session-a');
  tracker.stop('session-a', 0, 3_600_000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events.map((value) => value.eventType), ['play_start']);
});

test('queue deduplicates, persists across cache reset, and acknowledges FIFO events', async () => {
  setRecommendationStorageForTests(memoryStorage());
  const first = event(1);
  assert.equal(await enqueueRecommendationEvent(first), true);
  assert.equal(await enqueueRecommendationEvent(first), false);
  resetRecommendationQueueForTests();
  assert.deepEqual((await listPendingRecommendationEvents()).map((value) => value.idempotencyKey), [first.idempotencyKey]);
  assert.equal(await ackRecommendationEvents([first.idempotencyKey]), true);
  assert.equal((await listPendingRecommendationEvents()).length, 0);
});

test('queue enforces the 500-event cap and malformed storage recovers safely', async () => {
  const storage = memoryStorage({ '@novacast/recommendation-events-v1': JSON.stringify({ version: 1, events: [{ bad: true }] }) });
  setRecommendationStorageForTests(storage);
  assert.equal((await listPendingRecommendationEvents()).length, 0);
  for (let index = 0; index < RECOMMENDATION_QUEUE_MAX_EVENTS + 1; index += 1) {
    await enqueueRecommendationEvent(event(index));
  }
  const pending = await listPendingRecommendationEvents();
  assert.equal(pending.length, RECOMMENDATION_QUEUE_MAX_EVENTS);
  assert.equal(pending[0].providerContentId, 'movie-1');
});

test('queue storage failure is fail-closed and does not throw', async () => {
  setRecommendationStorageForTests({
    getItem: async () => { throw new Error('storage unavailable'); },
    setItem: async () => { throw new Error('storage unavailable'); },
  });
  assert.equal(await enqueueRecommendationEvent(event(1)), false);
  assert.deepEqual(await listPendingRecommendationEvents(), []);
  setRecommendationStorageForTests(null);
});

test('flusher ACKs accepted, duplicate, and permanent-invalid events but retains transient failures', async () => {
  setRecommendationStorageForTests(memoryStorage());
  resetRecommendationSyncForTests();
  await enqueueRecommendationEvent(event(1));
  await enqueueRecommendationEvent(event(2));
  await enqueueRecommendationEvent(event(3));
  await flushRecommendationEvents(async () => ({
    ok: false,
    accepted: 1,
    duplicates: 1,
    invalid: 1,
    transientFailed: 0,
    results: [
      { index: 0, status: 'accepted' },
      { index: 1, status: 'duplicate' },
      { index: 2, status: 'invalid' },
    ],
  }));
  assert.deepEqual(await listPendingRecommendationEvents(), []);

  await enqueueRecommendationEvent(event(4));
  let calls = 0;
  const send = async () => {
    calls += 1;
    throw new Error('offline');
  };
  await flushRecommendationEvents(send);
  assert.equal(calls, 1);
  assert.equal((await listPendingRecommendationEvents()).length, 1);
  setRecommendationStorageForTests(null);
});

test('concurrent flush calls share one in-flight request', async () => {
  setRecommendationStorageForTests(memoryStorage());
  resetRecommendationSyncForTests();
  await enqueueRecommendationEvent(event(5));
  let calls = 0;
  let release;
  const send = async (events) => {
    calls += 1;
    await new Promise((resolve) => { release = resolve; });
    return { ok: true, accepted: events.length, results: events.map((_event, index) => ({ index, status: 'accepted' })) };
  };
  const first = flushRecommendationEvents(send);
  const second = flushRecommendationEvents(send);
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal((await listPendingRecommendationEvents()).length, 0);
  setRecommendationStorageForTests(null);
});
