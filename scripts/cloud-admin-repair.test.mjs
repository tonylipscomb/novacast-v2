import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../pairing-web/src/styles.css', import.meta.url), 'utf8');
const devices = fs.readFileSync(new URL('../pairing-web/src/AdminDevices.tsx', import.meta.url), 'utf8');
const cloud = fs.readFileSync(new URL('../pairing-web/src/AdminCloud.tsx', import.meta.url), 'utf8');
const backend = fs.readFileSync(new URL('../supabase/functions/admin-device-action/index.ts', import.meta.url), 'utf8');

test('premium admin style markers exist', () => {
  for (const marker of ['.metricGrid', '.dashboardGrid', '.dashPanel', '.deviceMetricGrid', '.deviceTablePanel']) {
    assert.ok(styles.includes(marker), marker);
  }
});

test('admin source is ASCII clean', () => {
  assert.doesNotMatch(devices, /[^\x00-\x7F]/);
  assert.doesNotMatch(cloud, /[^\x00-\x7F]/);
});

test('extension fallback is installed', () => {
  assert.match(backend, /mode: 'fallback'/);
  assert.match(backend, /device_activations/);
  assert.match(backend, /activation_status: 'active'/);
});

test('extension errors are surfaced', () => {
  assert.match(cloud, /Beta access could not be extended/);
  assert.match(cloud, /admin_update_failed/);
});