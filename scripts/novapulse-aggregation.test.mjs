import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260920122851_novapulse_recommendation_aggregates_v1.sql', import.meta.url), 'utf8');
const edge = fs.readFileSync(new URL('../supabase/functions/novapulse-recommendation-aggregate/index.ts', import.meta.url), 'utf8');

const WEIGHTS = { meaningful_watch: 3, complete: 4, repeat_watch: 5, favorite_add: 4, watchlist_add: 4 };

function dedupe(events) {
  return [...new Map(events.map((event) => [event.idempotencyKey, event])).values()];
}

function trend(events, start, end) {
  const rows = events.filter((event) => event.occurredAt >= start && event.occurredAt <= end);
  const meaningful = rows.filter((event) => ['meaningful_watch', 'complete', 'repeat_watch', 'favorite_add', 'watchlist_add'].includes(event.eventType));
  const uniqueViewers = new Set(meaningful.map((event) => event.deviceId)).size;
  const count = (type) => rows.filter((event) => event.eventType === type).length;
  const starts = count('play_start');
  const meaningfulViews = count('meaningful_watch');
  const completions = count('complete');
  const repeatViews = count('repeat_watch');
  const favoriteAdds = count('favorite_add');
  const favoriteRemoves = count('favorite_remove');
  const watchlistAdds = count('watchlist_add');
  const watchlistRemoves = count('watchlist_remove');
  const score = uniqueViewers * 10 + meaningfulViews * 5 + completions * 3 + repeatViews * 2 +
    Math.max(0, favoriteAdds - favoriteRemoves) * 2 + Math.max(0, watchlistAdds - watchlistRemoves) * 2 + starts * 0.25;
  return { starts, meaningfulViews, completions, repeatViews, favoriteAdds, watchlistAdds, uniqueViewers, score };
}

function affinity(events) {
  const meaningful = events.filter((event) => Object.hasOwn(WEIGHTS, event.eventType));
  const perViewerContent = new Map();
  for (const event of meaningful) {
    const key = `${event.deviceId}|${event.fingerprint}|${event.contentType}`;
    const previous = perViewerContent.get(key);
    if (!previous || WEIGHTS[event.eventType] > previous.weight) {
      perViewerContent.set(key, { ...event, weight: WEIGHTS[event.eventType] });
    }
  }
  const grouped = new Map();
  const byViewer = new Map();
  for (const row of perViewerContent.values()) byViewer.set(row.deviceId, [...(byViewer.get(row.deviceId) ?? []), row]);
  for (const rows of byViewer.values()) {
    for (let left = 0; left < rows.length; left += 1) for (let right = left + 1; right < rows.length; right += 1) {
      const a = rows[left];
      const b = rows[right];
      const aKey = `${a.fingerprint}|${a.contentType}`;
      const bKey = `${b.fingerprint}|${b.contentType}`;
      const [source, target] = aKey < bKey ? [a, b] : [b, a];
      const key = `${source.fingerprint}|${source.contentType}|${target.fingerprint}|${target.contentType}`;
      const current = grouped.get(key) ?? { source: source.fingerprint, target: target.fingerprint, uniqueViewers: 0, weightedScore: 0 };
      current.uniqueViewers += 1;
      current.weightedScore += Math.min(5, a.weight + b.weight);
      grouped.set(key, current);
    }
  }
  return [...grouped.values()];
}

const base = (overrides = {}) => ({
  deviceId: 'viewer-a',
  fingerprint: 'c1_a',
  contentType: 'movie',
  eventType: 'meaningful_watch',
  occurredAt: '2026-09-20T00:00:00.000Z',
  idempotencyKey: `viewer-a|c1_a|meaningful_watch|2026-09-20T00:00:00.000Z`,
  ...overrides,
});

test('migration defines compact 24h/7d trend windows and exact weighted score inputs', () => {
  assert.match(migration, /window_key text not null check \(window_key in \('24h', '7d'\)\)/);
  assert.match(migration, /\(unique_viewers \* 10\) \+ \(meaningful_views \* 5\) \+ \(completions \* 3\) \+ \(repeat_views \* 2\)/);
  assert.match(migration, /starts \* 0\.25/);
});

test('play_start alone has weak trend weight and no meaningful viewer', () => {
  const result = trend([base({ eventType: 'play_start' })], '2026-09-19T00:00:00.000Z', '2026-09-21T00:00:00.000Z');
  assert.equal(result.uniqueViewers, 0);
  assert.equal(result.score, 0.25);
});

test('meaningful, completion, repeat, favorite, and watchlist signals increase score', () => {
  const weak = trend([base({ eventType: 'play_start' })], '2026-09-19T00:00:00.000Z', '2026-09-21T00:00:00.000Z');
  const strong = trend([
    base({ eventType: 'meaningful_watch' }),
    base({ eventType: 'complete', idempotencyKey: '2' }),
    base({ eventType: 'repeat_watch', idempotencyKey: '3' }),
    base({ eventType: 'favorite_add', idempotencyKey: '4' }),
    base({ eventType: 'watchlist_add', idempotencyKey: '5' }),
  ], '2026-09-19T00:00:00.000Z', '2026-09-21T00:00:00.000Z');
  assert.ok(strong.score > weak.score);
  assert.equal(strong.uniqueViewers, 1);
});

test('removals reduce net interest signals but never create positive weight', () => {
  const result = trend([
    base({ eventType: 'favorite_add' }),
    base({ eventType: 'favorite_remove', idempotencyKey: '2' }),
    base({ eventType: 'watchlist_remove', idempotencyKey: '3' }),
  ], '2026-09-19T00:00:00.000Z', '2026-09-21T00:00:00.000Z');
  assert.equal(result.score, 10);
});

test('24h and 7d windows differ and velocity is deterministic with smoothing', () => {
  const events = [base({ eventType: 'meaningful_watch', occurredAt: '2026-09-20T00:00:00.000Z' }), base({ eventType: 'meaningful_watch', deviceId: 'viewer-b', idempotencyKey: '2', occurredAt: '2026-09-15T00:00:00.000Z' })];
  const recent = trend(events, '2026-09-19T00:00:00.000Z', '2026-09-21T00:00:00.000Z');
  const baseline = trend(events, '2026-09-13T00:00:00.000Z', '2026-09-21T00:00:00.000Z');
  const velocity = (recent.score - baseline.score / 7) / Math.max(baseline.score / 7, 1);
  assert.notEqual(recent.score, baseline.score);
  assert.equal(velocity, (recent.score - baseline.score / 7) / Math.max(baseline.score / 7, 1));
});

test('duplicate idempotency references cannot double count a trend', () => {
  const duplicate = base({ idempotencyKey: 'same' });
  assert.deepEqual(trend(dedupe([duplicate, duplicate]), '2026-09-19T00:00:00.000Z', '2026-09-21T00:00:00.000Z'), trend([duplicate], '2026-09-19T00:00:00.000Z', '2026-09-21T00:00:00.000Z'));
});

test('affinity requires meaningful behavior and excludes play_start/abandon', () => {
  const rows = affinity([
    base({ fingerprint: 'c1_a', eventType: 'play_start' }),
    base({ fingerprint: 'c1_b', eventType: 'abandon', idempotencyKey: '2' }),
  ]);
  assert.deepEqual(rows, []);
});

test('same viewer creates one symmetric affinity edge with capped contribution', () => {
  const rows = affinity([
    base({ fingerprint: 'c1_a', eventType: 'repeat_watch' }),
    base({ fingerprint: 'c1_b', eventType: 'complete', idempotencyKey: '2' }),
    base({ fingerprint: 'c1_a', eventType: 'favorite_add', idempotencyKey: '3' }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].uniqueViewers, 1);
  assert.equal(rows[0].weightedScore, 5);
});

test('multiple viewers strengthen affinity and deterministic ties sort by target', () => {
  const rows = affinity([
    base({ fingerprint: 'c1_a', eventType: 'meaningful_watch' }),
    base({ fingerprint: 'c1_b', eventType: 'meaningful_watch', idempotencyKey: '2' }),
    base({ fingerprint: 'c1_a', eventType: 'meaningful_watch', deviceId: 'viewer-b', idempotencyKey: '3' }),
    base({ fingerprint: 'c1_b', eventType: 'meaningful_watch', deviceId: 'viewer-b', idempotencyKey: '4' }),
  ]);
  assert.equal(rows[0].uniqueViewers, 2);
  assert.equal(rows[0].weightedScore, 10);
  assert.ok(rows.every((row) => row.source !== row.target));
});

test('client-visible support thresholds and hard read limits are enforced by SQL helpers', () => {
  assert.match(migration, /t\.unique_viewers >= greatest\(1, p_min_unique_viewers\)/);
  assert.match(migration, /a\.co_watch_count >= greatest\(1, p_min_co_watch_count\)/);
  assert.match(migration, /limit least\(greatest\(coalesce\(p_limit, 1\), 1\), 100\)/);
  assert.match(migration, /limit least\(greatest\(coalesce\(p_limit, 1\), 1\), 50\)/);
});

test('aggregate tables and helpers are service-role-only and raw viewer refs are not read', () => {
  assert.match(migration, /alter table public\.novapulse_content_trends enable row level security/);
  assert.match(migration, /alter table public\.novapulse_content_affinity enable row level security/);
  assert.match(migration, /revoke all on table public\.novapulse_content_trends from anon, authenticated/);
  assert.match(migration, /revoke all on table public\.novapulse_content_affinity from anon, authenticated/);
  assert.match(migration, /grant execute on function public\.get_novapulse_top_trends[^\n]+to service_role/);
  assert.match(migration, /grant execute on function public\.get_novapulse_affinity[^\n]+to service_role/);
  assert.doesNotMatch(migration.slice(migration.indexOf('create or replace function public.get_novapulse_top_trends')), /device_id/);
  assert.doesNotMatch(migration.slice(migration.indexOf('create or replace function public.get_novapulse_affinity')), /device_id/);
});

test('aggregation endpoint is protected, bounded, and emits sanitized diagnostics', () => {
  assert.match(edge, /x-novapulse-aggregation-secret/);
  assert.match(edge, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(edge, /p_retention_days: retention/);
  assert.match(edge, /NOVAPULSE_RECS_AGG/);
  assert.doesNotMatch(edge, /fingerprint|deviceId|provider_ref/);
});
