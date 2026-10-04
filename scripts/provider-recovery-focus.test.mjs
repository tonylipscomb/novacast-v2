import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const recovery = read('src/features/providers/ProviderAccessRecoveryScreen.tsx');
const settings = read('src/features/settings/SettingsScreen.tsx');
const focus = read('src/features/providers/providerRecoveryFocus.ts');
const diagnostics = read('src/features/providers/providerRecoveryDiagnostics.ts');
const gate = read('src/features/providers/ProviderAccessGate.tsx');
const portal = read('src/features/portal/NovaPortalScreen.tsx');

test('both recovery surfaces use cancellable post-mount native focus', () => {
  assert.match(recovery, /focusProviderRecoveryViewWhenReady/);
  assert.match(settings, /focusProviderRecoveryViewWhenReady/);
  assert.match(focus, /requestAnimationFrame/);
  assert.match(focus, /cancelAnimationFrame/);
  assert.match(recovery, /hasTVPreferredFocus=\{focusTarget === 'pair'\}/);
  assert.match(settings, /hasTVPreferredFocus=\{focusTarget === 'portal'\}/);
});

test('retry failure restores focus to Retry without changing retry semantics', () => {
  assert.match(recovery, /setFocusTarget\('retry'\)/);
  assert.match(settings, /setFocusTarget\('retry'\)/);
  assert.match(recovery, /retryProviderInitialization\(\)/);
  assert.match(settings, /retryProviderInitialization\(\)/);
  assert.doesNotMatch(recovery, /clearProvidersForPairing|removeProviderCredentials/);
  assert.doesNotMatch(settings, /clearProvidersForPairing|removeProviderCredentials/);
});

test('directional focus graphs and Back routing remain unchanged', () => {
  assert.match(recovery, /nextFocusRight=\{focusTargets\.settings/);
  assert.match(recovery, /nextFocusLeft=\{focusTargets\.pair/);
  assert.match(settings, /nextFocusUp=\{focusTargets\.portal/);
  assert.match(settings, /nextFocusDown=\{\(retryAvailable \? focusTargets\.retry : focusTargets\.portal\)/);
  assert.match(settings, /router\.replace\(TV_HOME_ROUTE\)/);
  assert.match(settings, /router\.replace\('\/pair'\)/);
});

test('recovery diagnostics are sanitized and access semantics remain unchanged', () => {
  assert.match(diagnostics, /NOVACAST_PROVIDER_RECOVERY_FOCUS/);
  assert.match(diagnostics, /NOVACAST_PROVIDER_ACCESS/);
  for (const forbidden of ['providerUrl', 'username', 'password', 'token', 'authorization', 'rawError']) {
    assert.doesNotMatch(diagnostics, new RegExp(forbidden, 'i'));
  }
  assert.match(gate, /resolveProviderAccess/);
  assert.match(gate, /closedBetaMode/);
  assert.match(gate, /ProviderAccessRecoveryScreen/);
});

test('blocked Portal provider card remains a non-focusable View', () => {
  assert.match(portal, /if \(!launchable\)/);
  assert.match(portal, /return <View[^>]*providerCardStatic/);
  assert.match(portal, /launchable=\{canEnterApp\}/);
});

console.log('provider recovery focus: passed');
