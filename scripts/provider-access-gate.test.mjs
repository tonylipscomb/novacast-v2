import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(root, file), 'utf8');

test('shared access model distinguishes confirmed blocks from temporary states', () => {
  const source = read('src/features/providers/providerAccess.ts');
  assert.match(source, /'loading'/);
  assert.match(source, /'allowed'/);
  assert.match(source, /'no_provider'/);
  assert.match(source, /'authentication_required'/);
  assert.match(source, /'subscription_expired'/);
  assert.match(source, /'temporarily_unavailable'/);
  assert.match(source, /provider\.status === 'expired'/);
  assert.match(source, /providerHealth\?\.status === 'subscription_expired'/);
  assert.match(source, /Temporary network loss/);
  assert.match(source, /providerSwitchError/);
});

test('public provider-dependent routes share the guard while closed beta bypasses it', () => {
  const gate = read('src/features/providers/ProviderAccessGate.tsx');
  assert.match(gate, /isClosedBetaManagedFlow/);
  assert.match(gate, /closedBetaMode/);
  assert.match(gate, /return <>\{children\}<\/>;/);
  for (const route of ['main-menu.tsx', 'movies.tsx', 'series.tsx', 'live.tsx', 'guide.tsx']) {
    assert.match(read(`src/app/${route}`), /ProviderAccessGate/);
  }
});

test('recovery actions preserve credentials and use the existing retry path', () => {
  const source = read('src/features/providers/ProviderAccessRecoveryScreen.tsx');
  assert.match(source, /retryProviderInitialization/);
  assert.match(source, /router\.replace\('\/pair'\)/);
  assert.match(source, /router\.replace\('\/settings'\)/);
  assert.doesNotMatch(source, /resetPairing|removeProviderCredentials|clearProvider/);
});

test('portal launch uses the shared access decision', () => {
  const source = read('src/features/portal/NovaPortalScreen.tsx');
  assert.match(source, /resolveProviderAccess/);
  assert.match(source, /providerAccess\.state === 'allowed'/);
});
