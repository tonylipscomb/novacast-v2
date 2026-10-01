import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDeviceActivity, readPlaybackSummary, resolveDeviceRecord, sanitizeProviderSummary } from './deviceInspectorModel.ts';

test('resolves an inspector device by public code or stable id', () => {
  const devices = [{ id: 'device-1', public_device_code: 'NC-TEST-01' }];
  assert.equal(resolveDeviceRecord(devices, 'nc-test-01')?.id, 'device-1');
  assert.equal(resolveDeviceRecord(devices, 'device-1')?.public_device_code, 'NC-TEST-01');
  assert.equal(resolveDeviceRecord(devices, 'missing'), null);
});

test('provider summary exposes only safe operational fields', () => {
  const summary = sanitizeProviderSummary(
    { managed_provider_id: 'provider-1', providerName: 'Assigned', providerStatus: 'GOOD' },
    { id: 'provider-1', display_name: 'Managed', health_status: 'healthy', password: 'must-not-render' },
  );
  assert.equal(summary.name, 'Managed');
  assert.equal('password' in summary, false);
  assert.equal('username' in summary, false);
});

test('missing playback data is distinguishable from an available empty state', () => {
  assert.equal(readPlaybackSummary({}).available, false);
  assert.equal(readPlaybackSummary({ recentPlayback: { contentType: 'Movie', finalResult: 'completed' } }).available, true);
});

test('activity timeline uses available heartbeat, assignment, and diagnostic events only', () => {
  const rows = buildDeviceActivity({
    last_seen_at: '2026-09-30T10:00:00Z',
    assignment_command_status: 'applied',
    events: [{ id: 'event-1', event_type: 'playback_error', level: 'error', event_at: '2026-09-30T11:00:00Z', secret: 'excluded' }],
  });
  assert.equal(rows.some((row) => row.id === 'event-1'), true);
  assert.equal(rows.some((row) => row.detail === 'excluded'), false);
});
