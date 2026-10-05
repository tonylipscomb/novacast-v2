import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const device = read('supabase/functions/_shared/device.ts');
const create = read('supabase/functions/pairing-create/index.ts');
const status = read('supabase/functions/pairing-status/index.ts');
const redeem = read('supabase/functions/pairing-redeem/index.ts');
const migration = read('supabase/migrations/20261005090000_auto_activate_device_after_pairing.sql');

test('registered inactive devices can bootstrap pairing without opening general access', () => {
  assert.match(device, /device\.status === 'registered' && device\.activation_status === 'inactive'/);
  assert.match(create, /canBootstrapPairingForDevice\(authenticatedDevice\)/);
  assert.match(status, /canBootstrapPairingForDevice\(authenticatedDevice\)/);
  assert.match(status, /session\.device_id !== authenticatedDevice\.id/);
});

test('pairing status and redeem enforce installation and device ownership', () => {
  assert.match(status, /assertPairingSessionOwnership\(session, installationHash, authenticatedDevice\)/);
  assert.match(redeem, /assertPairingSessionOwnership\(session, installationHash, authenticatedDevice\)/);
  assert.match(redeem, /session\.device_id === authenticatedDevice\.id/);
});

test('redeem activates only after completed validated pairing and before credentials are returned', () => {
  assert.match(redeem, /autoActivateDeviceAfterPairing\(client, session\.id, authenticatedDevice\.id\)/);
  assert.ok(redeem.indexOf('autoActivateDeviceAfterPairing') < redeem.indexOf('redemption_consumed_at'));
  assert.match(migration, /pairing\.state <> 'completed'/);
  assert.match(migration, /pairing\.provider_record_id is null/);
  assert.match(migration, /pairing\.device_id is distinct from p_device_id/);
});

test('blocked, revoked, expired, and suspended devices cannot bootstrap', () => {
  assert.match(migration, /target\.status in \('blocked', 'revoked'\)/);
  assert.match(migration, /target\.activation_status in \('expired', 'revoked', 'suspended'\)/);
  assert.match(migration, /target\.status <> 'registered' or target\.activation_status <> 'inactive'/);
});

test('activation is idempotent and retains admin control fields', () => {
  assert.match(migration, /status = 'active'/);
  assert.match(migration, /if existing\.id is not null/);
  assert.match(migration, /revoke execute on function/);
  assert.doesNotMatch(migration, /drop table|truncate|delete from public\.devices/i);
});

test('activation diagnostics contain only approved metadata', () => {
  assert.match(device, /\[NovaCastDeviceActivation\]/);
  assert.match(device, /auto-activation-started/);
  assert.match(device, /auto-activation-complete/);
  assert.match(device, /auto-activation-skipped/);
  assert.match(device, /auto-activation-failed/);
  const loggerStart = device.indexOf('function logDeviceActivation');
  const loggerEnd = device.indexOf('export async function autoActivateDeviceAfterPairing');
  const diagnosticLogger = loggerStart >= 0 && loggerEnd > loggerStart ? device.slice(loggerStart, loggerEnd) : '';
  assert.ok(diagnosticLogger);
  assert.doesNotMatch(diagnosticLogger, /deviceSecret|password|token|providerUrl|pairingCode/i);
});
