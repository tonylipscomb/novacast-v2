import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync('supabase/migrations/20260919200547_novapulse_sports_events.sql', 'utf8');
const refresh = fs.readFileSync('supabase/functions/novapulse-sports-refresh/index.ts', 'utf8');
const adapter = fs.readFileSync('supabase/functions/_shared/novapulseSports.ts', 'utf8');
const auth = fs.readFileSync('supabase/functions/_shared/novapulseSportsAuth.ts', 'utf8');
const client = fs.readFileSync('src/features/novapulse/novaPulseSportsSource.ts', 'utf8');

test('sports event storage is idempotent and read-only to clients', () => {
  assert.match(migration, /unique \(provider, provider_event_id\)/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /for select/);
  assert.doesNotMatch(migration, /for insert|for update|for delete/);
});

test('refresh is bounded and uses server-only credentials', () => {
  assert.match(adapter, /THESPORTSDB_API_KEY/);
  assert.match(refresh, /NOVAPULSE_SPORTS_REFRESH_SECRET/);
  assert.match(refresh, /upcoming\(now, UPCOMING_DAYS\)/);
  assert.match(refresh, /recent\(now, RECENT_DAYS\)/);
  assert.match(refresh, /onConflict: 'provider,provider_event_id'/);
  assert.doesNotMatch(client, /THESPORTSDB|THESPORTSDB_API_KEY|NOVAPULSE_SPORTS_REFRESH_SECRET|Deno\.env/);
});

test('refresh authorization requires non-empty exact credentials', () => {
  assert.match(auth, /configuredSecret && suppliedSecret && suppliedSecret === configuredSecret/);
  assert.match(auth, /serviceRoleKey && bearerToken && bearerToken === serviceRoleKey/);
  assert.match(refresh, /isNovaPulseSportsRefreshAuthorized/);
});

test('client feed caps upcoming and finals and has safe fallback signals', () => {
  assert.match(client, /maxUpcoming \?\? 3/);
  assert.match(client, /maxFinal \?\? 2/);
  assert.match(client, /if \(upcoming\.error \|\| finals\.error\) return null/);
  assert.match(client, /if \(!rows\.length\) return null/);
  assert.match(client, /return stale \? null/);
});

test('real sports items replace only the mock sports subset while unavailable data keeps fallback', () => {
  const hook = fs.readFileSync('src/features/novapulse/useNovaPulseFeed.ts', 'utf8');
  assert.match(hook, /createNovaPulseSportsSource\(realSports\)/);
  assert.match(hook, /item\.type !== 'sports'/);
  assert.match(hook, /catch\(\(\) => \{ if \(active\) setRealSports\(null\)/);
});

test('client source gates winner and final-result metadata by event status', () => {
  assert.match(client, /const isFinal = row\.event_status === 'final'/);
  assert.match(client, /winnerName: isFinal \? row\.winner_name/);
  assert.match(client, /resultMethod: isFinal \? row\.result_method/);
});
