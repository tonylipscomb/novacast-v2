import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const coordinator = read('src/features/device/deviceStartup.ts');
const gate = read('src/features/startup/PublicStartupGate.tsx');
const index = read('src/app/index.tsx');
const activation = read('src/features/device/deviceActivation.ts');

test('public startup hydrates before initialization and shares one process promise', () => {
  assert.match(coordinator, /let startupPromise: Promise<DeviceState> \| null = null/);
  assert.match(coordinator, /if \(startupPromise\) \{[\s\S]*return startupPromise/);
  assert.match(coordinator, /hydrateCachedDeviceState\(\)[\s\S]*\.then\(\(\) => initializeDevice\(\)\)/);
  assert.match(coordinator, /publish\(\{ phase: 'hydrating'/);
  assert.match(coordinator, /publish\(\{ phase: 'ready'/);
});

test('pending startup cannot render the public shell or route to Pair', () => {
  assert.match(gate, /startup\.phase !== 'ready'/);
  assert.match(gate, /Starting NovaCast/);
  assert.doesNotMatch(gate, /router\.(replace|push).*pair/);
  assert.match(index, /<PublicStartupGate>/);
  assert.match(index, /<NovaPortalScreen \/>/);
});

test('failed startup remains non-authorized and retryable', () => {
  assert.match(coordinator, /publish\(\{ phase: 'failed', error \}\)/);
  assert.match(coordinator, /startupPromise = null/);
  assert.match(gate, /startup\.phase === 'failed'/);
  assert.match(gate, /startDeviceStartup\(\)\.catch/);
});

test('public barrier does not alter closed-beta StartupGate selection', () => {
  assert.match(index, /if \(isClosedBetaManagedFlow\(\) \|\| deviceFeatureFlags\.closedBetaMode\) \{[\s\S]*return <StartupGate \/>;/);
  assert.match(activation, /export function hydrateCachedDeviceState\(\)/);
  assert.match(activation, /export function initializeDevice\(\)/);
});

test('the barrier has no provider clearing path during hydration', () => {
  assert.doesNotMatch(coordinator, /clearProvidersForPairing|resetPairing|clearDevice/);
  assert.doesNotMatch(gate, /clearProvidersForPairing|resetPairing|clearDevice/);
});
