import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ACTIVATION_DIAGNOSTICS_MARKER,
  isPreciseActivationErrorCode,
  resolveActivationClientGate,
  sanitizeActivationErrorCode,
} from '../src/features/device/activationDiagnostics.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const inviteActivation = read('src/features/device/inviteActivation.ts');
const deviceActivate = read('supabase/functions/device-activate/index.ts');
const rpcFix = read('supabase/migrations/20260723181000_fix_activate_device_id_ambiguity.sql');
const workflow = read('.github/workflows/android-beta.yml');
const diagnostics = read('src/features/device/activationDiagnostics.ts');
const registration = read('src/features/device/deviceRegistration.ts');
const featureFlags = read('src/features/device/deviceFeatureFlags.ts');
const ui = read('src/features/device/BetaInviteActivationScreen.tsx');

test('client gate: beta invites disabled returns precise code', () => {
  const gate = resolveActivationClientGate({
    betaInvitesEnabled: false,
    apiConfigured: true,
    publicDeviceCodePresent: true,
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.errorCode, 'beta_invites_disabled');
});

test('client gate: missing pairing API returns precise code (Stage 4A root cause)', () => {
  const gate = resolveActivationClientGate({
    betaInvitesEnabled: true,
    apiConfigured: false,
    publicDeviceCodePresent: true,
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.errorCode, 'pairing_api_unconfigured');
  assert.equal(gate.failureStage, 'pairing-api-unconfigured');
});

test('client gate: missing device code returns precise code', () => {
  const gate = resolveActivationClientGate({
    betaInvitesEnabled: true,
    apiConfigured: true,
    publicDeviceCodePresent: false,
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.errorCode, 'device_code_missing');
});

test('client gate: valid config passes', () => {
  assert.deepEqual(
    resolveActivationClientGate({
      betaInvitesEnabled: true,
      apiConfigured: true,
      publicDeviceCodePresent: true,
    }),
    { ok: true },
  );
});

test('activation_unavailable is only unknown fallback after sanitize', () => {
  assert.equal(sanitizeActivationErrorCode('device_not_found'), 'device_not_found');
  assert.equal(sanitizeActivationErrorCode('invite_expired'), 'invite_expired');
  assert.equal(sanitizeActivationErrorCode('!!!'), 'activation_unavailable');
  assert.equal(sanitizeActivationErrorCode(''), null);
  assert.equal(isPreciseActivationErrorCode('activation_unavailable'), false);
  assert.equal(isPreciseActivationErrorCode('pairing_api_unconfigured'), true);
  assert.equal(isPreciseActivationErrorCode('device_not_found'), true);
});

test('inviteActivation uses precise client gates and diagnostics', () => {
  assert.match(inviteActivation, /resolveActivationClientGate/);
  assert.match(inviteActivation, /logActivationClient/);
  assert.match(inviteActivation, /requestStarted:\s*true/);
  assert.match(inviteActivation, /failureStage/);
  assert.match(inviteActivation, /earlyGate\.errorCode|pairing_api_unconfigured/);
  assert.match(inviteActivation, /invitationCodePresent/);
  assert.doesNotMatch(inviteActivation, /pairing-create|pairing-redeem|pairing-submit/);
  assert.match(inviteActivation, /device-activate/);
  assert.match(inviteActivation, /registerDevice/);
});

test('device-activate preserves RPC error codes and emits server/db diagnostics', () => {
  assert.match(deviceActivate, /\[NovaCast Activation Server\]/);
  assert.match(deviceActivate, /\[NovaCast Activation DB\]/);
  assert.match(deviceActivate, /device_not_found/);
  assert.match(deviceActivate, /invite_not_found/);
  assert.match(deviceActivate, /invite_expired/);
  assert.match(deviceActivate, /invite_inactive/);
  assert.match(deviceActivate, /originalErrorCode/);
  assert.match(deviceActivate, /returnedErrorCode/);
  assert.match(deviceActivate, /rlsSuspected/);
  assert.match(deviceActivate, /getAdminClient/);
});

test('RPC raises precise codes for missing device / invite / expired / exhausted', () => {
  assert.match(rpcFix, /raise exception 'device_not_found'/);
  assert.match(rpcFix, /raise exception 'invite_not_found'/);
  assert.match(rpcFix, /raise exception 'invite_expired'/);
  assert.match(rpcFix, /raise exception 'invite_exhausted'/);
  assert.match(rpcFix, /raise exception 'device_blocked'/);
  assert.match(rpcFix, /security definer/);
  assert.match(rpcFix, /grant execute[\s\S]*service_role/);
});

test('registerDevice no-ops without pairing API (ordering implication)', () => {
  assert.match(registration, /if \(!config\) \{/);
  assert.match(registration, /return identity;/);
  assert.match(registration, /device-register/);
});

test('closed-beta feature flag defaults enable invites when env unset', () => {
  assert.match(featureFlags, /BETA_INVITES_ENABLED[\s\S]{0,40}true/);
  assert.match(featureFlags, /CLOSED_BETA_MODE[\s\S]{0,40}true/);
});

test('CI workflow bakes pairing API + closed-beta flags for activation APKs', () => {
  assert.match(workflow, /secrets\.EXPO_PUBLIC_NOVACAST_PAIRING_API_URL/);
  assert.match(workflow, /secrets\.EXPO_PUBLIC_SUPABASE_ANON_KEY/);
  assert.match(workflow, /EXPO_PUBLIC_BETA_INVITES_ENABLED: 'true'/);
  assert.match(workflow, /EXPO_PUBLIC_CLOSED_BETA_MODE: 'true'/);
  assert.match(workflow, /Verify pairing env for activation builds/);
});

test('UI maps pairing_api_unconfigured to a clear message', () => {
  assert.match(ui, /pairing_api_unconfigured/);
  assert.match(ui, /beta_invites_disabled/);
  assert.match(ui, /device_code_missing/);
});

test('diagnostics never include secret field names in helper module', () => {
  assert.match(diagnostics, new RegExp(ACTIVATION_DIAGNOSTICS_MARKER));
  assert.doesNotMatch(diagnostics, /\banonKey\b|\bserviceRole\b|\bdeviceSecret\b|\bpassword\b/i);
  const sample = JSON.stringify({
    stage: 'failure',
    deviceId: 'NC-ZAYY-74P3',
    invitationCodePresent: true,
    requestStarted: false,
    responseStatus: null,
    responseErrorCode: 'pairing_api_unconfigured',
    pairingSessionIdPresent: false,
    activationStatus: null,
    failureStage: 'pairing-api-unconfigured',
    marker: ACTIVATION_DIAGNOSTICS_MARKER,
  });
  assert.doesNotMatch(sample, /eyJ|service_role|Bearer /);
  assert.match(sample, /pairing_api_unconfigured/);
  assert.ok(!('invitationCode' in JSON.parse(sample)));
  assert.ok(!('anonKey' in JSON.parse(sample)));
});
