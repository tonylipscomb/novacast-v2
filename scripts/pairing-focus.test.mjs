import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const pairing = read('src/features/pairing/PairingScreen.tsx');
const diagnostics = read('src/features/pairing/pairingFocusDiagnostics.ts');

test('PairingScreen uses cancellable post-mount native focus restoration', () => {
  assert.match(pairing, /focusProviderRecoveryViewWhenReady/);
  assert.match(pairing, /return cancelFocus/);
  assert.match(pairing, /native-ref-not-ready/);
  assert.match(pairing, /pairingFocusKeyRef\.current === pairingFocusKey/);
});

test('initial focus targets a visible actionable control with fallbacks', () => {
  assert.match(pairing, /retryActionRef\.current : primaryActionRef\.current\) \?\? closeActionRef\.current/);
  assert.match(pairing, /hasTVPreferredFocus=\{!isAvailable \|\| !retryVisible\}/);
});

test('directional pairing focus graph remains explicit', () => {
  assert.match(pairing, /nextFocusDown=\{\(retryVisible \? focusTargets\.retry : focusTargets\.close\)/);
  assert.match(pairing, /nextFocusUp=\{focusTargets\.primary/);
  assert.match(pairing, /nextFocusUp=\{\(retryVisible \? focusTargets\.retry : focusTargets\.primary\)/);
});

test('focus diagnostics are sanitized and contain no pairing/provider secrets', () => {
  assert.match(diagnostics, /\[NOVACAST_PAIRING_FOCUS\]/);
  assert.doesNotMatch(diagnostics, /pairingCode|pairUrl|username|password|authorization|deviceSecret|token|supabase/i);
  assert.match(pairing, /logPairingFocus\('focus-received'/);
  assert.match(pairing, /logPairingFocus\('action-pressed'/);
  assert.match(pairing, /logPairingFocus\('state-changed'/);
});

test('pairing network behavior remains on the existing service path', () => {
  assert.match(pairing, /regenerateCode/);
  assert.match(pairing, /handlePairingRetry/);
  assert.match(pairing, /router\.back\(\)/);
  assert.doesNotMatch(pairing, /pairing-create|pairing-submit|pairing-redeem/);
});
