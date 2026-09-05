import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveDeviceSupportRows,
  deriveGoldSummary,
  deriveOpsSummary,
  deriveProviderHealthSummary,
  deriveReleaseReadiness,
  goldCreditsTone,
  readDashboardCore,
} from './operationsCenter.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-04T00:00:00.000Z');

test('readDashboardCore unwraps the nested admin-dashboard payload', () => {
  assert.deepEqual(readDashboardCore({ dashboard: { devicesOnline: 5 } }), { devicesOnline: 5 });
  // Tolerates an already-unwrapped object.
  assert.deepEqual(readDashboardCore({ devicesOnline: 3 }), { devicesOnline: 3 });
  assert.deepEqual(readDashboardCore(null), {});
});

test('deriveGoldSummary classifies accounts from real fields only', () => {
  const accounts = [
    { gold_enabled: true, gold_expiration: new Date(NOW + 30 * DAY).toISOString(), managed_provider_id: 'p1', provider: {}, assignedDevice: {} },
    { gold_enabled: true, gold_expiration: new Date(NOW + 3 * DAY).toISOString(), managed_provider_id: 'p2', provider: {}, assignedDevice: null },
    { gold_enabled: true, gold_expiration: new Date(NOW - 2 * DAY).toISOString(), managed_provider_id: null, provider: null, assignedDevice: null },
    { gold_enabled: false, gold_expiration: new Date(NOW + 30 * DAY).toISOString(), managed_provider_id: 'p4', provider: {}, assignedDevice: {} },
  ];
  const summary = deriveGoldSummary(accounts, { credits: 12, enabled: true }, NOW);
  assert.equal(summary.total, 4);
  assert.equal(summary.active, 2);
  assert.equal(summary.expiringSoon, 1);
  assert.equal(summary.expired, 1);
  assert.equal(summary.disabled, 1);
  assert.equal(summary.unassignedProvider, 1);
  assert.equal(summary.unassignedDevice, 2);
  assert.equal(summary.credits, 12);
  // No per-account route_health in list data => not reliable, count stays 0.
  assert.equal(summary.routeAlerts, 0);
  assert.equal(summary.routeAlertsReliable, false);
});

test('goldCreditsTone maps capacity to real tones', () => {
  assert.equal(goldCreditsTone(null), 'neutral');
  assert.equal(goldCreditsTone(0), 'critical');
  assert.equal(goldCreditsTone(3), 'warning');
  assert.equal(goldCreditsTone(50), 'healthy');
});

test('deriveProviderHealthSummary reuses shared health semantics', () => {
  const providers = [
    { id: 'a', display_name: 'Alpha', status: 'active', health_status: 'healthy', validation_stale: false },
    { id: 'b', display_name: 'Bravo', status: 'active', health_status: 'failed', validation_stale: false, goldAccount: {} },
    { id: 'c', display_name: 'Charlie', status: 'active', health_status: 'degraded', validation_stale: false },
    { id: 'd', display_name: 'Delta', status: 'draft', health_status: 'unvalidated', validation_stale: true },
  ];
  const summary = deriveProviderHealthSummary(providers);
  assert.equal(summary.total, 4);
  assert.equal(summary.healthy, 1);
  assert.equal(summary.draft, 1);
  assert.equal(summary.goldManaged, 1);
  assert.equal(summary.needsAttention, 2);
  // Failed provider is surfaced first.
  assert.equal(summary.unhealthy[0].name, 'Bravo');
  assert.equal(summary.unhealthy[0].tone, 'fail');
});

test('deriveDeviceSupportRows surfaces offline/unassigned devices first', () => {
  const devices = [
    { id: '1', public_device_code: 'AAA', last_seen_at: new Date(NOW - 60 * 1000).toISOString(), managed_provider_id: 'p1', activation_status: 'active' },
    { id: '2', public_device_code: 'BBB', last_seen_at: new Date(NOW - 5 * DAY).toISOString(), managed_provider_id: null, activation_status: 'active' },
  ];
  const rows = deriveDeviceSupportRows(devices, NOW);
  assert.equal(rows[0].code, 'BBB');
  assert.equal(rows[0].online, false);
  assert.equal(rows[1].online, true);
});

test('deriveReleaseReadiness returns real binary signals', () => {
  const core = { devicesOnline: 4, providers: 2, recentErrors: [{}], pendingActivations: 1 };
  const providerHealth = deriveProviderHealthSummary([
    { id: 'a', status: 'active', health_status: 'healthy', validation_stale: false },
  ]);
  const gold = deriveGoldSummary([], { credits: 0 }, NOW);
  const signals = deriveReleaseReadiness({ core, providerHealth, gold, deviceCount: 6 });
  const byId = Object.fromEntries(signals.map((s) => [s.id, s]));
  assert.equal(byId.devices.tone, 'healthy');
  assert.equal(byId.gold.state, 'Empty');
  assert.equal(byId.gold.tone, 'critical');
  assert.equal(byId.diagnostics.state, 'Alerts');
});

test('deriveOpsSummary counts critical alerts from real signals', () => {
  const core = { devicesOnline: 0, activatedDevices: 3, recentErrors: [{}, {}] };
  const providerHealth = deriveProviderHealthSummary([
    { id: 'b', display_name: 'Bravo', status: 'active', health_status: 'failed', validation_stale: false },
  ]);
  const gold = deriveGoldSummary(
    [{ gold_enabled: true, gold_expiration: new Date(NOW - DAY).toISOString() }],
    { credits: 2 },
    NOW,
  );
  const metrics = deriveOpsSummary({ core, providerHealth, gold, deviceCount: 4 });
  const byId = Object.fromEntries(metrics.map((m) => [m.id, m]));
  // 2 recent errors + 1 failed provider + 1 expired gold = 4
  assert.equal(byId.alerts.value, 2);
  assert.equal(byId.alerts.tone, 'critical');
  assert.equal(byId.devicesOnline.tone, 'warning');
  assert.equal(byId.goldCredits.tone, 'warning');
});
