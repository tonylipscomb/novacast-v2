import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const settings = read('src/features/settings/SettingsScreen.tsx');
const portal = read('src/features/portal/NovaPortalScreen.tsx');
const pairing = read('src/features/pairing/PairingScreen.tsx');
const hub = read('src/features/hub/ContentHubOverlayScreen.tsx');
const diagnostics = read('src/features/pairing/pairingDiagnostics.ts');
const service = read('src/features/pairing/pairingService.ts');
const model = read('src/features/providers/providerModel.ts');
const gate = read('src/features/providers/ProviderAccessGate.tsx');

test('restricted Settings does not mount the full shell', () => {
  assert.match(settings, /if \(providerAccess\.state !== 'allowed'\)/);
  assert.match(settings, /<RestrictedSettingsSurface state=\{providerAccess\.state\} \/>/);
  assert.match(settings, /Provider Portal/);
  assert.match(settings, /Pair Provider/);
});

test('recovery states cannot reach Home through Settings', () => {
  assert.match(settings, /Home, Movies, Series, Live, Guide, and Search remain locked/);
  assert.doesNotMatch(settings.slice(settings.indexOf('function RestrictedSettingsSurface'), settings.indexOf('const restrictedStyles')), /NovaTvShell/);
});

test('allowed state retains the existing full Settings shell', () => {
  assert.match(settings, /<NovaTvShell/);
  assert.match(settings, /activeId="settings"/);
});

test('pairing diagnostics expose status and safe auth-presence fields', () => {
  assert.match(diagnostics, /statusCode\?: number \| null/);
  assert.match(diagnostics, /serverErrorCode\?: string \| null/);
  assert.match(diagnostics, /deviceIdentityFieldsPresent\?: boolean/);
  assert.match(diagnostics, /activationDeviceAuthHeadersPresent\?: boolean/);
  assert.match(service, /statusCode: response\.status/);
  assert.match(service, /serverErrorCode:/);
  const logPayload = diagnostics.slice(diagnostics.indexOf("console.info('[NovaCast Pairing Diagnostics]"));
  assert.doesNotMatch(logPayload, /deviceSecret|apiUrl|password|authorization/i);
});

test('portal actions have deterministic focus and safe focus diagnostics', () => {
  assert.match(portal, /controlId=\{item\.id\}/);
  assert.match(portal, /nextFocusUp=\{/);
  assert.match(portal, /nextFocusDown=\{/);
  assert.match(portal, /logOverlayFocus\('portal'/);
});

test('pairing unavailable state has an explicit action focus chain', () => {
  assert.match(pairing, /nativeRef=\{primaryActionRef\}/);
  assert.match(pairing, /hasTVPreferredFocus=\{!isAvailable \|\| !retryVisible\}/);
  assert.match(pairing, /nextFocusDown=\{\(retryVisible \? focusTargets\.retry : focusTargets\.close\)/);
  assert.match(pairing, /nativeRef=\{closeActionRef\}/);
  assert.match(pairing, /logOverlayFocus\('pairing'/);
});

test('provider overlay contains focus and selection diagnostics', () => {
  assert.match(portal, /logOverlayFocus\('provider-overlay'/);
  assert.match(hub, /logOverlayFocus\('provider-overlay'/);
  assert.match(portal, /nextFocusDown=\{index < providers\.length - 1/);
  assert.match(portal, /disabled=\{provider\.status === 'expired' \|\| provider\.status === 'offline'\}/);
  assert.match(hub, /provider\.status === 'expired' \|\| provider\.status === 'offline'/);
});

test('cached provider fallback rejects expired and disabled states but allows unknown/degraded state', () => {
  assert.match(model, /export function isCachedProviderUsable/);
  assert.match(model, /provider\.status === 'expired' \|\| provider\.status === 'offline'/);
  assert.match(model, /\['expired', 'disabled', 'banned', 'offline'\]/);
  assert.match(gate, /cachedProviderUsable = providerState\.isRealProviderActive/);
});

test('startup latency regression remains bounded and retryable', () => {
  const source = read('scripts/provider-startup-latency.test.mjs');
  assert.match(source, /12_000/);
  assert.match(source, /recovery_available/);
  assert.match(source, /retry/);
});
