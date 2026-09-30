import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const realtime = fs.readFileSync(
  new URL('../src/features/device/deviceAssignmentRealtime.ts', import.meta.url),
  'utf8',
);
const heartbeat = fs.readFileSync(
  new URL('../src/features/device/deviceHeartbeat.ts', import.meta.url),
  'utf8',
);
const layout = fs.readFileSync(
  new URL('../src/app/_layout.tsx', import.meta.url),
  'utf8',
);

test('realtime startup is single-flight and generation-safe', () => {
  assert.match(realtime, /let startPromise: Promise<void> \| null = null/);
  assert.match(realtime, /if \(startPromise\) return startPromise/);
  assert.match(realtime, /let lifecycleGeneration = 0/);
  assert.match(realtime, /generation !== lifecycleGeneration/);
  assert.match(realtime, /assignment-changed/);
});

test('errored realtime channels are detached before bounded retry', () => {
  assert.match(realtime, /channel-removed/);
  assert.match(realtime, /await erroredChannel\.unsubscribe\(\)/);
  assert.match(realtime, /removeChannel\(erroredChannel\)/);
  assert.match(realtime, /const RETRY_DELAYS_MS = \[1_000, 2_000, 4_000, 8_000, 15_000\]/);
  assert.match(realtime, /if \(!lifecycleBound \|\| generation !== lifecycleGeneration \|\| retryTimer\) return/);
});

test('heartbeat reports sanitized configuration, transport, and reconciliation outcomes', () => {
  assert.match(heartbeat, /config-missing/);
  assert.match(heartbeat, /request-started/);
  assert.match(heartbeat, /network-failure/);
  assert.match(heartbeat, /http-result/);
  assert.match(heartbeat, /activation-state-applied/);
  assert.match(heartbeat, /provider-assignment-reconciled/);
  assert.doesNotMatch(heartbeat, /logHeartbeat\([^;]+deviceSecret/);
  assert.match(heartbeat, /source: 'heartbeat'/);
});

test('foreground/resume heartbeat is coalesced with the existing interval', () => {
  assert.match(layout, /let heartbeatInFlight = false/);
  assert.match(layout, /if \(heartbeatInFlight\) return/);
  assert.match(layout, /setInterval\(\(\) => \{/);
  assert.match(layout, /if \(state === 'active'\) runHeartbeat\(\)/);
  assert.match(layout, /appStateSubscription\.remove\(\)/);
});

