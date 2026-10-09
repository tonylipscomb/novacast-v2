import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDeviceActivity, deviceLifecycleStatus, hasLegacyActivationHistory, readPlaybackSummary, resolveDeviceRecord, sanitizeProviderSummary } from './deviceInspectorModel.ts';

test('resolves an inspector device by public code or stable id', () => {
  const devices = [{ id: 'device-1', public_device_code: 'NC-TEST-01' }];
  assert.equal(resolveDeviceRecord(devices, 'nc-test-01')?.id, 'device-1');
  assert.equal(resolveDeviceRecord(devices, 'device-1')?.public_device_code, 'NC-TEST-01');
  assert.equal(resolveDeviceRecord(devices, 'missing'), null);
});

test('provider summary exposes only safe operational fields', () => {
  const summary = sanitizeProviderSummary(
    { managed_provider_id: 'provider-1', assignment_id: 'assignment-1', assigned_at: '2026-10-01T12:00:00Z', providerName: 'Assigned', providerStatus: 'GOOD' },
    { id: 'provider-1', display_name: 'Managed', health_status: 'healthy', password: 'must-not-render' },
  );
  assert.equal(summary.name, 'Managed');
  assert.equal(summary.assignment, 'Assigned');
  assert.equal(summary.assignedAt, '2026-10-01T12:00:00Z');
  assert.equal('password' in summary, false);
  assert.equal('username' in summary, false);
});

test('device inspector separates production status from legacy activation history', () => {
  assert.equal(deviceLifecycleStatus({ status: 'active', activation_status: 'expired' }), 'ACTIVE');
  assert.equal(hasLegacyActivationHistory({ activation_source: 'beta', activation_expires_at: '2020-01-01' }), true);
  assert.equal(hasLegacyActivationHistory({ activation_source: 'production', activation_expires_at: '2020-01-01' }), false);
  assert.equal(hasLegacyActivationHistory({ activation_status: 'expired' }), true);
});

test('unassigned device has safe assignment fallback', () => {
  const summary = sanitizeProviderSummary({}, null);
  assert.equal(summary.assignment, 'Unassigned');
  assert.equal(summary.assignedAt, null);
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
