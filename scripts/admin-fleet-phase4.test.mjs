import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const devices = read('supabase/functions/admin-devices/index.ts');
const dashboard = read('supabase/functions/admin-dashboard/index.ts');
const playback = read('supabase/functions/admin-playback-history/index.ts');
const web = read('pairing-web/src/AdminDevices.tsx');
const nav = read('pairing-web/src/adminNavigation.ts');

test('admin devices keeps admin auth and bounded server pagination', () => {
  assert.match(devices, /await requireAdmin\(request\)/);
  assert.match(devices, /pageSize = Math\.min\(Math\.max/);
  assert.match(devices, /count: 'exact'/);
  assert.match(devices, /totalPages/);
  assert.match(devices, /order\('last_seen_at'.*order\('id'/s);
});

test('admin devices exposes operational filters without credential fields', () => {
  for (const field of ['status', 'activation', 'version', 'providerId', 'providerHealth', 'search']) assert.match(devices, new RegExp(field));
  assert.doesNotMatch(devices, /password|username|encrypted|stream_url/i);
});

test('dashboard returns full-fleet aggregate data', () => {
  assert.match(dashboard, /fleetSummary/);
  assert.match(dashboard, /providerHealthCounts/);
  assert.match(dashboard, /versionDistribution/);
  assert.match(dashboard, /playbackFailureCount/);
  assert.match(dashboard, /diagnosticIssueCount/);
});

test('playback history is authenticated, paginated, newest-first, and projected safely', () => {
  assert.match(playback, /await requireAdmin\(request\)/);
  assert.match(playback, /diagnostic_sessions/);
  assert.match(playback, /order\('started_at', \{ ascending: false \}\)/);
  assert.match(playback, /totalPages/);
  assert.doesNotMatch(playback, /password|username|stream_host|token|secret/i);
});

test('frontend uses server pagination and keeps playback route reachable', () => {
  assert.match(web, /onQueryChange/);
  assert.match(web, /pagination\.total/);
  assert.match(nav, /\/admin\/playback/);
});
