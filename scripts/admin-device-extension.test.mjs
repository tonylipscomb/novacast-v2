import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const devices = fs.readFileSync(
  new URL('../pairing-web/src/AdminDevices.tsx', import.meta.url),
  'utf8',
);
const backend = fs.readFileSync(
  new URL('../supabase/functions/admin-device-action/index.ts', import.meta.url),
  'utf8',
);
const expired = fs.readFileSync(
  new URL('../src/features/device/BetaExpiredScreen.tsx', import.meta.url),
  'utf8',
);

test('Devices screen offers preset, custom, and never-expiring access options', () => {
  assert.match(devices, /7 days/);
  assert.match(devices, /30 days/);
  assert.match(devices, /90 days/);
  assert.match(devices, /Never expires/);
  assert.match(devices, /datetime-local/);
});

test('Admin backend accepts bounded custom extension hours', () => {
  assert.match(backend, /MAX_EXTENSION_HOURS = 24 \* 365 \* 100/);
  assert.match(backend, /Number\.isInteger\(hours\)/);
  assert.doesNotMatch(backend, /EXTENSION_HOURS\.has/);
});

test('Expired TV screen always displays the public NovaCast Device ID', () => {
  assert.match(expired, /publicDeviceCode/);
  assert.match(expired, />Device ID</);
  assert.match(expired, /Give your Device ID to the administrator/);
});