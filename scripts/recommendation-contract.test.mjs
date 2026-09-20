import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRecommendationIdempotencyKey,
  classifyRecommendationAbandonment,
  createRecommendationEvent,
  createRecommendationFingerprint,
  createRecommendationMilestoneTracker,
  isMeaningfulWatch,
  isRecommendationComplete,
  normalizeRecommendationTitle,
  meaningfulWatchThresholdMs,
  shouldEmitStateTransition,
  validateRecommendationYear,
} from '../src/features/novapulse/recommendationContract.ts';

const NOW = new Date('2026-09-20T00:00:00.000Z');

function identity(overrides = {}) {
  return {
    contentType: 'movie',
    title: '  Dune: Part  Two  ',
    year: '2024',
    ...overrides,
  };
}

test('same metadata and same title/year across providers share a correlation fingerprint', () => {
  const fingerprint = createRecommendationFingerprint(identity(), NOW);
  assert.equal(fingerprint, 'movie|dune:part two|2024');
  assert.equal(createRecommendationFingerprint(identity({ title: 'Dune: Part Two' }), NOW), fingerprint);
  assert.notEqual('provider-a:movie-1', 'provider-b:movie-9');
});

test('valid year participates, invalid or missing year does not', () => {
  assert.equal(createRecommendationFingerprint(identity({ year: 2025 }), NOW), 'movie|dune:part two|2025');
  assert.equal(createRecommendationFingerprint(identity({ year: 1800 }), NOW), 'movie|dune:part two');
  assert.equal(createRecommendationFingerprint(identity({ year: '2028' }), NOW), 'movie|dune:part two|2028');
  assert.equal(createRecommendationFingerprint(identity({ year: '2029' }), NOW), 'movie|dune:part two');
  assert.equal(validateRecommendationYear('1887', NOW), null);
  assert.equal(validateRecommendationYear('1888', NOW), 1888);
  assert.equal(validateRecommendationYear('2028', NOW), 2028);
});

test('normalization is Unicode-safe, conservative, and does not remove meaningful words', () => {
  assert.equal(normalizeRecommendationTitle('  Café   Society — Director\'s Cut  '), "café society — director's cut");
  assert.notEqual(normalizeRecommendationTitle('The Thing'), normalizeRecommendationTitle('Thing'));
});

test('episode fingerprint includes series, year, season, and episode identity', () => {
  assert.equal(
    createRecommendationFingerprint({ contentType: 'episode', seriesTitle: 'The Office', seriesYear: 2005, seasonNumber: '2', episodeNumber: '03' }, NOW),
    'episode|the office|2005|s02|e03',
  );
  assert.notEqual(
    createRecommendationFingerprint({ contentType: 'episode', seriesTitle: 'The Office', seriesYear: 2005, seasonNumber: '2', episodeNumber: '04' }, NOW),
    'episode|the office|2005|s02|e03',
  );
});

test('live fingerprints use only normalized channel identity', () => {
  assert.equal(createRecommendationFingerprint({ contentType: 'live', title: '  News  One ' }, NOW), 'live|news one');
});

test('movie meaningful threshold is max five minutes/ten percent capped at ten minutes', () => {
  assert.equal(meaningfulWatchThresholdMs('movie', 30 * 60_000), 5 * 60_000);
  assert.equal(meaningfulWatchThresholdMs('movie', 90 * 60_000), 9 * 60_000);
  assert.equal(meaningfulWatchThresholdMs('movie', 3 * 60 * 60_000), 10 * 60_000);
  assert.equal(isMeaningfulWatch('movie', 5 * 60_000, 30 * 60_000), true);
});

test('episode threshold is max two minutes/ten percent capped at five minutes', () => {
  assert.equal(meaningfulWatchThresholdMs('episode', 10 * 60_000), 2 * 60_000);
  assert.equal(meaningfulWatchThresholdMs('episode', 40 * 60_000), 4 * 60_000);
  assert.equal(meaningfulWatchThresholdMs('episode', 90 * 60_000), 5 * 60_000);
});

test('short content uses the 25 percent exception', () => {
  assert.equal(meaningfulWatchThresholdMs('movie', 4 * 60_000), 60_000);
  assert.equal(meaningfulWatchThresholdMs('episode', 60_000), 15_000);
  assert.equal(isMeaningfulWatch('episode', 15_000, 60_000), true);
});

test('completion delegates to existing playback completion semantics', () => {
  assert.equal(isRecommendationComplete(552_000, 600_000), true);
  assert.equal(isRecommendationComplete(400_000, 1_200_000), false);
});

test('abandonment is only before meaningful watch and completion', () => {
  assert.equal(classifyRecommendationAbandonment({ contentType: 'movie', started: true, stopped: true, positionMs: 60_000, durationMs: 60 * 60_000 }), true);
  assert.equal(classifyRecommendationAbandonment({ contentType: 'movie', started: true, stopped: true, positionMs: 6 * 60_000, durationMs: 60 * 60_000 }), false);
  assert.equal(classifyRecommendationAbandonment({ contentType: 'movie', started: false, stopped: true, positionMs: 0, durationMs: 60 * 60_000 }), false);
});

test('meaningful and complete milestones are one-shot per session/content', () => {
  const tracker = createRecommendationMilestoneTracker();
  const input = { sessionId: 'session-a', fingerprint: 'movie|x|2024', eventType: 'meaningful_watch', progressBucket: 'meaningful' };
  assert.equal(tracker.canEmit(input), true);
  assert.equal(tracker.canEmit(input), false);
  assert.equal(tracker.canEmit({ ...input, eventType: 'complete', progressBucket: 'complete' }), true);
  assert.equal(tracker.canEmit({ ...input, eventType: 'complete', progressBucket: 'complete' }), false);
});

test('repeat watch requires a second distinct meaningful session', () => {
  const tracker = createRecommendationMilestoneTracker();
  const base = { fingerprint: 'movie|x|2024', eventType: 'meaningful_watch', progressBucket: 'meaningful' };
  assert.equal(tracker.isRepeatWatch(base.fingerprint, 'session-a'), false);
  assert.equal(tracker.canEmit({ ...base, sessionId: 'session-a' }), true);
  assert.equal(tracker.isRepeatWatch(base.fingerprint, 'session-a'), false);
  assert.equal(tracker.isRepeatWatch(base.fingerprint, 'session-b'), true);
});

test('favorite and watchlist events require actual state transitions', () => {
  assert.equal(shouldEmitStateTransition(false, true), true);
  assert.equal(shouldEmitStateTransition(true, false), true);
  assert.equal(shouldEmitStateTransition(true, true), false);
});

test('idempotency is deterministic and event metadata cannot leak unrestricted fields', () => {
  const key = buildRecommendationIdempotencyKey({ sessionId: 's1', fingerprint: 'movie|x|2024', eventType: 'play_start' });
  assert.equal(key, buildRecommendationIdempotencyKey({ sessionId: 's1', fingerprint: 'movie|x|2024', eventType: 'play_start' }));
  assert.doesNotMatch(key, /https?:|password|token|title/i);
  const event = createRecommendationEvent({
    eventType: 'play_start', contentType: 'movie', fingerprint: 'movie|x|2024', providerId: 'provider-a',
    providerContentId: 'movie-1', sessionId: 's1', occurredAt: '2026-09-20T00:00:00.000Z',
  });
  assert.equal(event.idempotencyKey, key);
  assert.equal(Object.hasOwn(event, 'title'), false);
  assert.equal(Object.hasOwn(event, 'url'), false);
  assert.equal(Object.hasOwn(event, 'password'), false);
});
