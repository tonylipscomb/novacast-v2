import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const providersFn = fs.readFileSync(new URL('../supabase/functions/admin-providers/index.ts', import.meta.url), 'utf8');
const health = fs.readFileSync(new URL('../supabase/functions/_shared/providerHealth.ts', import.meta.url), 'utf8');
const runner = fs.readFileSync(new URL('../supabase/functions/_shared/providerHealthRunner.ts', import.meta.url), 'utf8');
const catalog = fs.readFileSync(new URL('../supabase/functions/_shared/providerHealthCatalog.ts', import.meta.url), 'utf8');
const adminUi = fs.readFileSync(new URL('../pairing-web/src/AdminProviders.tsx', import.meta.url), 'utf8');
const cloud = fs.readFileSync(new URL('../pairing-web/src/AdminCloud.tsx', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260816180000_provider_health_validation.sql', import.meta.url), 'utf8');

test('new providers are created as drafts, not active', () => {
  assert.match(providersFn, /status:\s*'draft'/);
  assert.doesNotMatch(providersFn, /status:\s*'active',\s*\n\s*health_status/);
});

test('activation is gated on health and does not trust the browser', () => {
  assert.match(providersFn, /action === 'activate'/);
  assert.match(providersFn, /canActivateFromHealth/);
  assert.match(providersFn, /activation_blocked/);
});

test('retest does not disable the provider', () => {
  const testBlock = providersFn.split("action === 'test'")[1]?.split("action === 'activate'")[0] ?? '';
  assert.match(testBlock, /health_status: 'testing'/);
  assert.doesNotMatch(testBlock, /status:\s*'paused'/);
  assert.doesNotMatch(testBlock, /status:\s*'revoked'/);
});

test('credentials stay server-side and diagnostics are sanitized', () => {
  assert.match(providersFn, /requireAdmin/);
  assert.match(providersFn, /decryptSecret/);
  assert.match(health, /sanitizeCredentialUrl/);
  assert.match(runner, /sanitizeFailureMessage/);
  assert.doesNotMatch(adminUi, /credentials_ciphertext/);
  assert.doesNotMatch(adminUi, /console\.log/);
});

test('catalog failures use distinct sanitized reasons instead of catalog_payload_invalid', () => {
  assert.doesNotMatch(runner, /catalog_payload_invalid/);
  assert.match(runner, /createXtreamCatalogScanner/);
  assert.match(runner, /fetchXtreamCatalog/);
  assert.match(runner, /Anonymous root access is not required/);
  assert.match(catalog, /catalog_payload_too_large/);
  assert.match(catalog, /catalog_invalid_json/);
  assert.match(catalog, /catalog_unexpected_shape/);
  assert.match(catalog, /catalog_html/);
});

test('stream probes remain sequential, bounded, and connection-limit aware', () => {
  assert.match(runner, /PROBE_MAX_BYTES = 2_048/);
  assert.match(runner, /Range: `bytes=0-/);
  assert.match(runner, /shouldRetryStreamWithoutRange/);
  assert.match(runner, /NOVACAST_STREAM_PROBE_UA/);
  assert.match(runner, /maxHops: 2/);
  assert.match(runner, /connectionSlotOccupied/);
  assert.match(runner, /skippedForConnectionLimit/);
  assert.match(health, /LIVE_PROBE_SAMPLE = 3/);
  assert.match(health, /MOVIE_PROBE_SAMPLE = 2/);
  assert.match(health, /EPISODE_PROBE_SAMPLE = 2/);
  assert.match(health, /stream_connection_limit/);
  assert.match(health, /stream_http_401/);
  assert.match(health, /stream_redirect_blocked/);
  assert.match(runner, /for \(const row of liveSamples\)/);
  assert.match(runner, /await probeStream/);
  assert.match(runner, /await yieldMs\(PROBE_YIELD_MS\)/);
  assert.doesNotMatch(runner, /Promise\.all\(.*probeStream/s);
  assert.match(runner, /account\.maxConnections \?\? 0\) === 1/);
  assert.doesNotMatch(runner, /playback endpoints are rejecting stream requests/);
  assert.match(health, /normalizePlaybackExtension/);
  assert.match(runner, /buildXtreamStreamUrl/);
});

test('health status stays independent from activation status', () => {
  assert.match(migration, /health_status/);
  assert.match(migration, /Independent from status/);
  assert.match(migration, /draft.*active.*paused.*revoked/s);
});

test('Admin Cloud mounts the Providers management page', () => {
  assert.match(cloud, /<AdminProviders/);
  assert.match(adminUi, /Add Provider/);
  assert.match(adminUi, /Retest/);
  assert.match(adminUi, /Diagnostics/);
  assert.match(adminUi, /Save as Draft/);
  assert.match(adminUi, /Save & Activate/);
  assert.match(adminUi, /Test Provider/);
  assert.match(adminUi, /summary.notes/);
});
