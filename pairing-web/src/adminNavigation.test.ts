import assert from 'node:assert/strict';
import test from 'node:test';

import { ADMIN_NAV_GROUPS, adminPathForDevice, adminPathForTab, resolveAdminLocation, resolveAdminTab } from './adminNavigation.ts';

test('admin deep links resolve to existing functional pages', () => {
  assert.equal(resolveAdminTab('/admin'), 'dashboard');
  assert.equal(resolveAdminTab('/admin/overview'), 'dashboard');
  assert.equal(resolveAdminTab('/admin/devices'), 'devices');
  assert.equal(resolveAdminTab('/admin/providers'), 'providers');
  assert.equal(resolveAdminTab('/admin/diagnostics'), 'diagnostics');
  assert.equal(resolveAdminTab('/admin/analytics'), 'diagnostics');
  assert.equal(resolveAdminTab('/admin/gold'), 'gold');
  assert.equal(resolveAdminTab('/admin/novapulse'), 'announcements');
  assert.equal(resolveAdminTab('/admin/announcements'), 'announcements');
  assert.equal(resolveAdminTab('/admin/release-testing'), 'invitations');
  assert.equal(resolveAdminTab('/admin/settings'), 'settings');
});

test('functional tab paths are stable and pairing remains a real public route', () => {
  assert.equal(adminPathForTab('dashboard'), '/admin/overview');
  assert.equal(adminPathForTab('diagnostics'), '/admin/diagnostics');
  assert.equal(adminPathForTab('announcements'), '/admin/novapulse');
  assert.equal(adminPathForTab('invitations'), '/admin/release-testing');
  assert.equal(ADMIN_NAV_GROUPS.flatMap((group) => group.items).find((item) => item.id === 'pairing')?.href, '/pair');
});

test('future destinations are visibly disabled rather than backed by invented data', () => {
  const items = ADMIN_NAV_GROUPS.flatMap((group) => group.items);
  assert.equal(items.find((item) => item.id === 'playback')?.disabled, true);
  assert.equal(items.find((item) => item.id === 'catalog')?.disabled, true);
  assert.equal(items.find((item) => item.id === 'service-health')?.disabled, true);
});

test('device inspector routes preserve device key and selected tab', () => {
  assert.equal(adminPathForDevice('NC-TEST-01', 'provider'), '/admin/devices/NC-TEST-01/provider');
  assert.deepEqual(resolveAdminLocation('/admin/devices/NC-TEST-01/diagnostics'), {
    tab: 'devices', deviceKey: 'NC-TEST-01', inspectorTab: 'diagnostics',
  });
  assert.deepEqual(resolveAdminLocation('/admin/devices/NC-TEST-01'), {
    tab: 'devices', deviceKey: 'NC-TEST-01', inspectorTab: 'overview',
  });
});
