import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('../pairing-web/src/App.tsx', import.meta.url), 'utf8');
const cloud = fs.readFileSync(new URL('../pairing-web/src/AdminCloud.tsx', import.meta.url), 'utf8');

test('/admin routes to the full Cloud Admin shell', () => {
  assert.match(app, /return <AdminCloud \/>/);
  assert.doesNotMatch(app, /startsWith\('\/admin'\).*<AdminPage/);
});

test('Cloud Admin mounts existing premium pages', () => {
  assert.match(cloud, /<AdminDashboard/);
  assert.match(cloud, /<AdminDevices/);
  assert.match(cloud, /<AdminInvitations/);
  assert.match(cloud, /<AdminProviders/);
});

test('Cloud Admin wires device extension to admin-device-action', () => {
  assert.match(cloud, /action: 'extend'/);
  assert.match(cloud, /onExtend=/);
  assert.match(cloud, /Beta access extended successfully/);
});

test('Cloud Admin wires provider reassignment to admin-device-action', () => {
  assert.match(cloud, /action: 'assign_provider'/);
  assert.match(cloud, /onAssignProvider=/);
  assert.match(cloud, /Provider changed to/);
});