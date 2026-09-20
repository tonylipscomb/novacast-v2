import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const providersFn = fs.readFileSync(new URL('../supabase/functions/admin-providers/index.ts', import.meta.url), 'utf8');
const health = fs.readFileSync(new URL('../supabase/functions/_shared/providerHealth.ts', import.meta.url), 'utf8');
const runner = fs.readFileSync(new URL('../supabase/functions/_shared/providerHealthRunner.ts', import.meta.url), 'utf8');
const catalog = fs.readFileSync(new URL('../supabase/functions/_shared/providerHealthCatalog.ts', import.meta.url), 'utf8');
const adminUi = fs.readFileSync(new URL('../pairing-web/src/AdminProviders.tsx', import.meta.url), 'utf8');
const pairing = fs.readFileSync(new URL('../pairing-web/src/pairing.ts', import.meta.url), 'utf8');
const cloud = fs.readFileSync(new URL('../pairing-web/src/AdminCloud.tsx', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260816180000_provider_health_validation.sql', import.meta.url), 'utf8');
const inventoryMigration = fs.readFileSync(new URL('../supabase/migrations/20260920120000_inventory_telemetry_v1.sql', import.meta.url), 'utf8');
const heartbeat = fs.readFileSync(new URL('../supabase/functions/device-heartbeat/index.ts', import.meta.url), 'utf8');
const catalogSync = fs.readFileSync(new URL('../src/features/providers/providerCatalogSync.ts', import.meta.url), 'utf8');

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
  assert.match(testBlock, /acquireProviderValidationLease/);
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
  assert.match(runner, /const CATALOG_TIMEOUT_MS = 45_000/);
  assert.match(catalog, /CATALOG_READ_LIMIT_BYTES = 128 \* 1024 \* 1024/);
  assert.match(runner, /Anonymous root access is not required/);
  assert.match(catalog, /catalog_payload_too_large/);
  assert.match(catalog, /catalog_invalid_json/);
  assert.match(catalog, /catalog_unexpected_shape/);
  assert.match(catalog, /catalog_html/);
});

test('provider validation uses a stale-recoverable race-safe lease', () => {
  assert.match(providersFn, /PROVIDER_VALIDATION_LEASE_MS = 3 \* 60 \* 1000/);
  assert.match(providersFn, /acquireProviderValidationLease/);
  assert.match(providersFn, /updated_at', new Date\(now - PROVIDER_VALIDATION_LEASE_MS\)/);
  assert.match(providersFn, /\.eq\('health_status', 'testing'\)/);
  assert.match(providersFn, /\.eq\('updated_at', testingAt\)/);
  assert.match(providersFn, /if \(!data\) throw new Error\('validation_in_progress'\)/);
});

test('bounded catalog counts carry truncation metadata and the Admin UI renders lower bounds', () => {
  assert.match(runner, /catalogs\.countDetails = \{/);
  assert.match(runner, /totalCount: liveStreamResult\.totalCount/);
  assert.match(runner, /exactCountAvailable: vodStreamResult\.exactCountAvailable/);
  assert.match(runner, /diagnosticTruncated: seriesListResult\.diagnosticTruncated/);
  assert.match(runner, /'get_live_streams'/);
  assert.match(runner, /'get_vod_streams'/);
  assert.match(runner, /'get_series'/);
  assert.match(adminUi, /isCappedCatalogCount/);
  assert.match(adminUi, /formatInventoryCount\(provider\.inventory_live_count, provider\.live_channel_count/);
  assert.match(adminUi, /formatInventoryCount\(provider\.inventory_movie_count, provider\.movie_count/);
  assert.match(adminUi, /formatInventoryCount\(provider\.inventory_series_count, provider\.series_count/);
});

test('inventory telemetry is separate, completion-gated, and assignment-owned', () => {
  for (const field of ['inventory_live_count', 'inventory_movie_count', 'inventory_series_count', 'inventory_live_counted_at', 'inventory_movie_counted_at', 'inventory_series_counted_at']) {
    assert.match(inventoryMigration, new RegExp(field));
  }
  assert.match(heartbeat, /authenticateDevice\(request, client\)/);
  assert.match(heartbeat, /device_provider_assignments/);
  assert.match(heartbeat, /inventoryReports/);
  assert.doesNotMatch(heartbeat, /body\.managed_provider_id/);
  assert.match(heartbeat, /sameDevice/);
  assert.match(heartbeat, /incomingTime < storedTime/);
  assert.match(catalogSync, /queueCompletedVodInventoryReport/);
  assert.match(catalogSync, /queueCompletedLiveInventoryReport/);
  assert.match(catalogSync, /getCatalogTotalCount\(providerId, mediaType/);
});

test('cloud-only 404/511 restrictions are separate from provider health', () => {
  assert.match(health, /export function isCloudPlaybackProbeRestricted/);
  assert.match(runner, /isCloudPlaybackProbeRestricted\(\{ checks, probes, catalogs \}\)/);
  assert.match(runner, /checks\.filter\(\(check\) => check\.id !== 'playback'\)/);
  assert.match(adminUi, /Restricted · Device verify/);
});

test('provider cards use a compact EPG summary and modal wizard', () => {
  const styles = fs.readFileSync(new URL('../pairing-web/src/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /providerCardGrid \{[^}]*minmax\(420px, 1fr\)/s);
  assert.match(adminUi, /providerEpgSummary/);
  assert.match(adminUi, /function EpgWizard/);
  assert.doesNotMatch(adminUi, /<details className="providerEpgDetails">/);
  assert.match(adminUi, />Coverage<\/button>/);
  assert.match(adminUi, />Audit<\/button>/);
  assert.match(adminUi, /epgSourceMore/);
  assert.match(adminUi, /Manage EPG/);
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

test('diagnostic watchdog and frontend failure paths are terminal and retryable', () => {
  assert.match(runner, /PROVIDER_HEALTH_WATCHDOG_MS = 90_000/);
  assert.match(runner, /Promise\.race\(\[/);
  assert.match(runner, /controller\.abort\(\)/);
  assert.match(runner, /finally \{[\s\S]*?clearTimeout\(timer\)/);
  assert.match(adminUi, /setFailedTestingId/);
  assert.match(adminUi, /setTestingId\(null\)/);
  assert.match(adminUi, /setInterval\(update, 1000\)/);
  assert.match(adminUi, /testingLeaseFresh = health === 'testing' && id !== failedTestingId/);
});

test('catalog counting stops expensive object parsing after the inspection cap', () => {
  assert.match(catalog, /if \(inspectedCount >= maxItems\)/);
  assert.match(catalog, /totalCount \+= 1/);
  assert.match(catalog, /diagnosticTruncated = true/);
  assert.match(runner, /exactCount: false/);
  assert.doesNotMatch(runner, /response\.json\(\)/);
  assert.match(runner, /bounded_response_body_unavailable/);
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

test('EPG size failures remain distinguishable and byte metrics are displayed', () => {
  assert.match(adminUi, /compressed_response_too_large/);
  assert.match(adminUi, /decompressed_response_too_large/);
  assert.match(adminUi, /compressedBytes/);
  assert.match(adminUi, /decompressedBytes/);
});

test('EPG worker resource failures have a safe user-facing category', () => {
  assert.match(adminUi, /EPG processing exceeded server resource limits/);
  assert.match(pairing, /response\.status === 546/);
  assert.match(pairing, /WORKER_RESOURCE_LIMIT/);
});
