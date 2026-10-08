import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const device = read('supabase/functions/_shared/device.ts');
const status = read('supabase/functions/device-status/index.ts');
const heartbeat = read('supabase/functions/device-heartbeat/index.ts');
const assignment = read('supabase/functions/device-provider-assignment/index.ts');
const epg = read('supabase/functions/device-epg/index.ts');
const migration = read('supabase/migrations/20261008232226_production_device_lifecycle_phase1.sql');

const tests = [
  ['shared helper recognizes production source', () => assert.match(device, /activation_source\?: string/)],
  ['shared helper bypasses expiry only for production', () => assert.match(device, /activation_source === 'production'/)],
  ['status reads activation source and uses shared authorization', () => {
    assert.match(status, /activation_source/);
    assert.match(status, /isDeviceAuthorizationActive/);
  }],
  ['heartbeat reads activation source and uses shared authorization', () => {
    assert.match(heartbeat, /activation_source/);
    assert.match(heartbeat, /isDeviceAuthorizationActive/);
  }],
  ['provider download uses shared authorization', () => {
    assert.match(assignment, /activation_source/);
    assert.match(assignment, /isDeviceAuthorizationActive/);
    assert.match(assignment, /provider_not_assigned/);
    assert.match(assignment, /provider_unavailable/);
  }],
  ['EPG uses shared authorization', () => {
    assert.match(epg, /activation_source/);
    assert.match(epg, /isDeviceAuthorizationActive/);
  }],
  ['pairing session TTL code is untouched by lifecycle patch', () => {
    const pairingRedeem = read('supabase/functions/pairing-redeem/index.ts');
    assert.match(pairingRedeem, /redemption_expires_at/);
    assert.match(pairingRedeem, /redemption_expired/);
  }],
  ['migration requires active device and production-use evidence', () => {
    assert.match(migration, /d\.status IN \('active', 'registered'\)/);
    assert.match(migration, /last_seen_at >= now\(\) - interval '30 days'/);
    assert.match(migration, /device_provider_assignments/);
  }],
  ['initial migration execution is heartbeat-backed only', () => {
    assert.match(migration, /Initial execution mode: heartbeat-backed candidates only/);
    const execution = migration.slice(migration.indexOf('Initial execution mode:'));
    assert.match(execution, /AND d\.last_seen_at >= now\(\) - interval '30 days'/);
    assert.doesNotMatch(execution, /OR EXISTS/);
  }],
  ['migration preserves expiry and assignment data while marking production', () => {
    assert.match(migration, /activation_source = 'production'/);
    assert.match(migration, /device_production_migration_snapshots/);
    assert.match(migration, /previous_device_status/);
    assert.doesNotMatch(migration, /expires_at\s*=\s*NULL/i);
    assert.doesNotMatch(migration, /device_provider_assignments\s+SET/i);
  }],
];

for (const [name, run] of tests) {
  run();
  console.log(`PASS ${name}`);
}
console.log(`${tests.length} production lifecycle checks passed`);
