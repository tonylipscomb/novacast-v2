import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync('supabase/migrations/20260919200547_novapulse_sports_events.sql', 'utf8') +
  fs.readFileSync('supabase/migrations/20260921034203_novapulse_sports_b2_schema.sql', 'utf8');
const refresh = fs.readFileSync('supabase/functions/novapulse-sports-refresh/index.ts', 'utf8');
const adapter = fs.readFileSync('supabase/functions/_shared/novapulseSports.ts', 'utf8');
const auth = fs.readFileSync('supabase/functions/_shared/novapulseSportsAuth.ts', 'utf8');
const client = fs.readFileSync('src/features/novapulse/novaPulseSportsSource.ts', 'utf8');
const feed = fs.readFileSync('supabase/functions/novapulse-sports-feed/index.ts', 'utf8');

test('sports event storage is idempotent and read-only to clients', () => {
  assert.match(migration, /rename column provider to source/);
  assert.match(migration, /rename column provider_event_id to source_event_id/);
  assert.match(migration, /on public\.novapulse_sports_events \(status, starts_at\)/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /for select/);
  assert.doesNotMatch(migration, /for insert|for update|for delete/);
  assert.match(migration, /revoke all on table public\.novapulse_sports_events from anon, authenticated/);
  assert.match(migration, /drop policy if exists novapulse_sports_events_public_read/);
});

test('refresh is bounded and uses server-only credentials', () => {
  assert.match(adapter, /THESPORTSDB_API_KEY/);
  assert.match(refresh, /NOVAPULSE_SPORTS_REFRESH_SECRET/);
  assert.match(refresh, /upcoming\(now, UPCOMING_DAYS\)/);
  assert.match(refresh, /recent\(now, RECENT_HOURS\)/);
  assert.match(refresh, /onConflict: 'source,source_event_id'/);
  assert.match(refresh, /expiredCount/);
  assert.doesNotMatch(client, /THESPORTSDB|THESPORTSDB_API_KEY|NOVAPULSE_SPORTS_REFRESH_SECRET|Deno\.env/);
});

test('refresh authorization requires non-empty exact credentials', () => {
  assert.match(auth, /configuredSecret && suppliedSecret && suppliedSecret === configuredSecret/);
  assert.match(auth, /serviceRoleKey && bearerToken && bearerToken === serviceRoleKey/);
  assert.match(refresh, /isNovaPulseSportsRefreshAuthorized/);
});

test('feed function is the only client-facing sports read path and caps results', () => {
  assert.match(feed, /MAX_UPCOMING = 6/);
  assert.match(feed, /MAX_FINAL = 2/);
  assert.match(feed, /PUBLIC_COLUMNS/);
  assert.match(feed, /not\('league_id', 'is', null\)/);
  assert.match(client, /novapulse-sports-feed/);
  assert.doesNotMatch(client, /from\('novapulse_sports_events'\)/);
});

test('real sports items replace only the mock sports subset while unavailable data keeps fallback', () => {
  const hook = fs.readFileSync('src/features/novapulse/useNovaPulseFeed.ts', 'utf8');
  assert.match(hook, /createNovaPulseSportsSource\(realSports\)/);
  assert.match(hook, /item\.type !== 'sports'/);
  assert.match(hook, /NOVA_PULSE_SPORTS_ENABLED/);
  assert.match(hook, /if \(active && items\) setRealSports\(items\)/);
});

test('client source gates winner and final-result metadata by event status', () => {
  assert.match(client, /const isFinal = row\.status === 'final'/);
  assert.match(client, /winnerName: isFinal \? row\.winner_name/);
  assert.match(client, /resultMethod: isFinal \? row\.result_method/);
});
