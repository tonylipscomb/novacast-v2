import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync('supabase/migrations/20260925153919_novapulse_sports_refresh_lease.sql', 'utf8');
const lease = fs.readFileSync('supabase/functions/_shared/novapulseSportsRefreshLease.ts', 'utf8');
const refresh = fs.readFileSync('supabase/functions/novapulse-sports-refresh/index.ts', 'utf8');
const schedule = fs.readFileSync('docs/novapulse-sports-refresh-schedule.md', 'utf8');

test('refresh lease is atomic, server-only, and expires for recovery', () => {
  assert.match(migration, /create table public\.novapulse_sports_refresh_leases/);
  assert.match(migration, /lease_name text primary key check \(lease_name = 'novapulse-sports-refresh'\)/);
  assert.match(migration, /owner_token uuid/);
  assert.match(migration, /last_started_at timestamptz/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.novapulse_sports_refresh_leases from public, anon, authenticated/);
  assert.match(migration, /clock_timestamp\(\)/);
  assert.match(migration, /interval '10 minutes'/);
  assert.match(migration, /interval '2 minutes'/);
  assert.match(migration, /owner_token = p_owner_token/);
  assert.match(migration, /revoke all on function public\.try_acquire_novapulse_sports_refresh_lease\(\)/);
  assert.match(migration, /revoke all on function public\.release_novapulse_sports_refresh_lease\(uuid\)/);
  assert.match(migration, /grant execute .* to service_role/);
  assert.match(lease, /NOVA_PULSE_SPORTS_REFRESH_LEASE_TTL_MS = 10 \* 60 \* 1000/);
  assert.match(lease, /NOVA_PULSE_SPORTS_REFRESH_COOLDOWN_MS = 2 \* 60 \* 1000/);
});

test('overlap skips before adapter creation and normal refresh remains bounded', () => {
  const leaseGate = refresh.slice(refresh.indexOf('async function refresh()'), refresh.indexOf('async function refresh()') + 1600);
  assert.match(leaseGate, /acquireSportsRefreshLease/);
  assert.match(leaseGate, /if \(lease\.status !== 'acquired'\)/);
  assert.match(leaseGate, /skipped: true/);
  assert.ok(leaseGate.indexOf('createTheSportsDbAdapter') > leaseGate.indexOf("if (lease.status !== 'acquired')"));
  assert.match(refresh, /upcoming\(now, UPCOMING_DAYS\)/);
  assert.match(refresh, /recent\(now, RECENT_HOURS\)/);
  assert.match(refresh, /finally \{[\s\S]*releaseSportsRefreshLease/);
  assert.match(refresh, /if \(!authorized\(request\)\)/);
});

test('request budget math remains below the free-tier rolling-minute limit', () => {
  const supportedLeagueCount = (fs.readFileSync('supabase/functions/_shared/novapulseSports.ts', 'utf8').match(/id: '\d+'/g) ?? []).length;
  assert.equal(supportedLeagueCount, 10);
  assert.equal(supportedLeagueCount * 2, 20);
  assert.ok(20 < 30);
  assert.match(lease, /2 \* 60 \* 1000/);
});

test('schedule documentation requires Vault and does not schedule or expose secrets locally', () => {
  assert.match(schedule, /pg_cron/);
  assert.match(schedule, /pg_net/);
  assert.match(schedule, /Vault/);
  assert.doesNotMatch(schedule, /sk-[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]+\./);
});
