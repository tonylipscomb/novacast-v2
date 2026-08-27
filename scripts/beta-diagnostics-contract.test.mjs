import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const ingest = read('supabase/functions/diagnostics-ingest/index.ts');
const admin = read('supabase/functions/admin-diagnostics/index.ts');
const playback = read('src/features/analytics/playbackAnalytics.ts');
const client = read('src/features/diagnostics/diagnosticsClient.ts');

test('admin diagnostics maps support-safe public device identity', () => {
  assert.match(admin, /public_device_code/);
  assert.match(admin, /assigned_tester_name/);
  assert.match(admin, /publicDeviceCode/);
  assert.doesNotMatch(admin, /device_secret|installation_hash|ip_hash|provider_password/i);
});

test('playback diagnostics transports the active item title', () => {
  assert.match(playback, /contentTitle: attempt\.item\.title/);
  assert.match(ingest, /content_title: contentTitle/);
  assert.match(admin, /latestContentTitle/);
});

test('session aggregation and safe network fields are wired', () => {
  assert.match(ingest, /diagnostic_sessions/);
  assert.match(ingest, /time_to_first_frame_ms/);
  assert.match(ingest, /network_connected/);
  assert.match(ingest, /connection_type/);
  assert.match(client, /networkConnected/);
  assert.match(client, /connectionType: 'unknown'/);
  assert.doesNotMatch(client, /ssid|bssid|mac|ipAddress|wifiPassword/i);
});

test('admin response derives playback identity and provider activity from recorded rows', () => {
  assert.match(admin, /playback\?\.content_title/);
  assert.match(admin, /providerActivityByDevice/);
  assert.match(admin, /lastSuccessfulProviderRequestAt/);
  assert.match(admin, /INSUFFICIENT_DATA/);
});

test('playback lifecycle uses correlated sessions and aggregate buffering fields', () => {
  assert.match(playback, /sessionId: createPlaybackSessionId\(\)/);
  assert.match(playback, /eventType: 'player_preparing'/);
  assert.match(playback, /totalBufferDurationMs: attempt\.bufferingDurationMs/);
  assert.match(ingest, /isUuid\(event\.sessionId\)/);
  assert.match(ingest, /total_buffer_duration_ms/);
});
