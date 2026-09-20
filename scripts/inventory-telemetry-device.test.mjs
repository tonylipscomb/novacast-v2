import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const telemetry = fs.readFileSync(new URL('../src/features/device/inventoryTelemetry.ts', import.meta.url), 'utf8');
const heartbeat = fs.readFileSync(new URL('../src/features/device/deviceHeartbeat.ts', import.meta.url), 'utf8');
const sync = fs.readFileSync(new URL('../src/features/providers/providerCatalogSync.ts', import.meta.url), 'utf8');

test('completed media publications queue exact final counts', () => {
  assert.match(sync, /getCatalogTotalCount\(providerId, mediaType, \{ generation: Number\(generation\) \}\)/);
  assert.match(sync, /queueCompletedVodInventoryReport\(providerId, 'movie', sqliteHandle\?\.generation\)/);
  assert.match(sync, /queueCompletedVodInventoryReport\(providerId, 'series', seriesFinishHandle\.generation\)/);
  assert.match(sync, /queueCompletedLiveInventoryReport\(providerId, generation, published\.channelCount\)/);
  assert.match(sync, /if \(!movieFinishOk\)/);
  assert.match(sync, /if \(!seriesFinishOk\)/);
  assert.match(sync, /if \(!published\.rebuilt \|\| published\.channelCount <= 0\)/);
});

test('heartbeat reports are optional, persisted, acknowledged, and superseded per media type', () => {
  assert.match(heartbeat, /await loadPendingInventoryReports\(\)/);
  assert.match(heartbeat, /inventoryReports/);
  assert.match(heartbeat, /acknowledgeInventoryReports\(inventoryReports/);
  assert.match(telemetry, /pending\.set\(report\.mediaType, report\)/);
  assert.match(telemetry, /persistChain/);
  assert.match(telemetry, /AsyncStorage\.setItem\(STORAGE_KEY, snapshot\)/);
  assert.match(telemetry, /current\?\.catalogGeneration === report\.catalogGeneration/);
  assert.doesNotMatch(heartbeat, /managed_provider_id/);
  assert.doesNotMatch(telemetry, /username|password|credentials/i);
});

test('heartbeat failure preserves queued reports and normal cadence is reused', () => {
  assert.match(heartbeat, /if \(!response \|\| !response\.ok\) \{[\s\S]*return null;/);
  assert.match(heartbeat, /acknowledgeInventoryReports/);
  assert.match(heartbeat, /fetch\(`\$\{apiUrl\}\/device-heartbeat`/);
});
