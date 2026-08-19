import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  assembleDeviceIdentity,
  evaluateExistingDeviceRegistration,
  interpretDeviceRegisterResponse,
  isDuplicateRegistrationConstraint,
  mergeDeviceIdentityWrite,
  shouldMintNewDeviceSecret,
  shouldSkipDeviceRegister,
} from '../src/features/device/deviceRegisterIdempotency.ts';

const INSTALLATION_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const DEVICE_SECRET = 'a'.repeat(64);
const WRONG_SECRET = 'b'.repeat(64);
const DEVICE_ID = '11111111-2222-3333-4444-555555555555';
const PUBLIC_CODE = 'NC-TEST-ABCD';

function createMemoryBackend() {
  const rows = [];
  const hash = (secret) => `hash:${secret}`;
  function register(installationId, deviceSecret) {
    const existingRow = rows.find((row) => row.installationId === installationId) ?? null;
    const decision = evaluateExistingDeviceRegistration({
      existing: existingRow
        ? {
            id: existingRow.id,
            publicDeviceCode: existingRow.publicDeviceCode,
            status: existingRow.status,
            deviceSecretHash: existingRow.secretHash,
          }
        : null,
      providedSecretHash: hash(deviceSecret),
    });
    if (decision.type === 'deny') {
      return { status: 400, body: { errorCategory: 'invalid_device' } };
    }
    if (decision.type === 'recover') {
      return {
        status: 200,
        body: {
          deviceId: decision.deviceId,
          publicDeviceCode: decision.publicDeviceCode,
          status: decision.status,
          recovered: true,
        },
      };
    }
    const row = {
      id: `dev-${rows.length + 1}`,
      publicDeviceCode: `NC-NEW-${String(rows.length + 1).padStart(4, '0')}`,
      installationId,
      secretHash: hash(deviceSecret),
      status: 'registered',
    };
    rows.push(row);
    return {
      status: 200,
      body: {
        deviceId: row.id,
        publicDeviceCode: row.publicDeviceCode,
        status: row.status,
        recovered: false,
      },
    };
  }
  return { register, rows };
}

test('A) new device registers and persists IDs for normal activation', () => {
  const backend = createMemoryBackend();
  const first = backend.register(INSTALLATION_ID, DEVICE_SECRET);
  assert.equal(first.status, 200);
  assert.equal(first.body.recovered, false);
  assert.equal(backend.rows.length, 1);

  const persisted = mergeDeviceIdentityWrite(
    {
      installationId: INSTALLATION_ID,
      deviceSecret: DEVICE_SECRET,
      deviceId: first.body.deviceId,
      publicDeviceCode: first.body.publicDeviceCode,
    },
    { deviceId: null, publicDeviceCode: null },
  );
  assert.equal(persisted.deviceId, first.body.deviceId);
  assert.equal(persisted.publicDeviceCode, first.body.publicDeviceCode);
  assert.equal(shouldSkipDeviceRegister(persisted), true);
});

test('B) complete local identity skips a new registration call', () => {
  assert.equal(
    shouldSkipDeviceRegister({ deviceId: DEVICE_ID, publicDeviceCode: PUBLIC_CODE }),
    true,
  );
});

test('C) existing backend device + incomplete local identity recovers without pairing again', () => {
  const backend = createMemoryBackend();
  const original = backend.register(INSTALLATION_ID, DEVICE_SECRET);
  backend.rows[0].status = 'active';

  const assembled = assembleDeviceIdentity({
    deviceInstallationId: null,
    pairingInstallationId: INSTALLATION_ID,
    legacyInstallationId: null,
    deviceSecret: DEVICE_SECRET,
    deviceId: null,
    publicDeviceCode: null,
  });
  assert.equal(assembled?.installationId, INSTALLATION_ID);
  assert.equal(assembled?.deviceId, null);
  assert.equal(shouldSkipDeviceRegister(assembled), false);
  assert.equal(shouldMintNewDeviceSecret(assembled.deviceSecret), false);

  const recovered = backend.register(assembled.installationId, assembled.deviceSecret);
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.recovered, true);
  assert.equal(recovered.body.deviceId, original.body.deviceId);
  assert.equal(recovered.body.publicDeviceCode, original.body.publicDeviceCode);
  assert.equal(backend.rows.length, 1);

  const interpreted = interpretDeviceRegisterResponse({
    ok: true,
    statusCode: 200,
    payload: recovered.body,
    previousDeviceId: null,
    previousPublicDeviceCode: null,
  });
  assert.equal(interpreted.ok, true);
  assert.equal(interpreted.recovered, true);

  const persisted = mergeDeviceIdentityWrite(
    {
      ...assembled,
      deviceId: interpreted.deviceId,
      publicDeviceCode: interpreted.publicDeviceCode,
    },
    { deviceId: null, publicDeviceCode: null },
  );
  assert.equal(persisted.deviceId, original.body.deviceId);
  assert.equal(persisted.publicDeviceCode, original.body.publicDeviceCode);
  assert.equal(shouldSkipDeviceRegister(persisted), true);
});

test('D) wrong device secret is denied without leaking another device', () => {
  const backend = createMemoryBackend();
  backend.register(INSTALLATION_ID, DEVICE_SECRET);
  const denied = backend.register(INSTALLATION_ID, WRONG_SECRET);
  assert.equal(denied.status, 400);
  assert.equal(denied.body.errorCategory, 'invalid_device');
  assert.equal('deviceId' in denied.body, false);
  assert.equal('publicDeviceCode' in denied.body, false);
  assert.equal(backend.rows.length, 1);

  const interpreted = interpretDeviceRegisterResponse({
    ok: false,
    statusCode: 400,
    payload: denied.body,
    previousDeviceId: null,
    previousPublicDeviceCode: null,
  });
  assert.equal(interpreted.ok, false);
  assert.equal(interpreted.errorCode, 'invalid_device');
});

test('E) repeated register with identical credentials returns the same device and no duplicate row', () => {
  const backend = createMemoryBackend();
  const first = backend.register(INSTALLATION_ID, DEVICE_SECRET);
  const second = backend.register(INSTALLATION_ID, DEVICE_SECRET);
  assert.equal(second.status, 200);
  assert.equal(second.body.deviceId, first.body.deviceId);
  assert.equal(second.body.publicDeviceCode, first.body.publicDeviceCode);
  assert.equal(backend.rows.length, 1);
});

test('identity assembly recovers pairing/legacy installation IDs without minting a new secret', () => {
  const assembled = assembleDeviceIdentity({
    deviceInstallationId: null,
    pairingInstallationId: INSTALLATION_ID,
    legacyInstallationId: null,
    deviceSecret: DEVICE_SECRET,
    deviceId: DEVICE_ID,
    publicDeviceCode: PUBLIC_CODE,
  });
  assert.deepEqual(assembled, {
    installationId: INSTALLATION_ID,
    deviceSecret: DEVICE_SECRET,
    deviceId: DEVICE_ID,
    publicDeviceCode: PUBLIC_CODE,
  });
  assert.equal(shouldMintNewDeviceSecret(DEVICE_SECRET), false);
  assert.equal(shouldMintNewDeviceSecret(null), true);
});

test('incomplete writes do not wipe already persisted registration IDs', () => {
  const merged = mergeDeviceIdentityWrite(
    {
      installationId: INSTALLATION_ID,
      deviceSecret: DEVICE_SECRET,
      deviceId: null,
      publicDeviceCode: null,
    },
    { deviceId: DEVICE_ID, publicDeviceCode: PUBLIC_CODE },
  );
  assert.deepEqual(merged, {
    installationId: INSTALLATION_ID,
    deviceSecret: DEVICE_SECRET,
    deviceId: DEVICE_ID,
    publicDeviceCode: PUBLIC_CODE,
  });
});

test('409 with IDs is treated as recovery, not device_registration_failed', () => {
  const interpreted = interpretDeviceRegisterResponse({
    ok: false,
    statusCode: 409,
    payload: { deviceId: DEVICE_ID, publicDeviceCode: PUBLIC_CODE },
    previousDeviceId: null,
    previousPublicDeviceCode: null,
  });
  assert.equal(interpreted.ok, true);
  assert.equal(interpreted.recovered, true);
});

test('duplicate unique-constraint detection covers Postgres 23505', () => {
  assert.equal(isDuplicateRegistrationConstraint({ code: '23505' }), true);
  assert.equal(isDuplicateRegistrationConstraint({ message: 'duplicate key value' }), true);
  assert.equal(isDuplicateRegistrationConstraint({ message: 'nope' }), false);
});

test('client and backend source contracts keep recovery explicit', () => {
  const registration = fs.readFileSync('src/features/device/deviceRegistration.ts', 'utf8');
  const activation = fs.readFileSync('src/features/device/deviceActivation.ts', 'utf8');
  const storage = fs.readFileSync('src/features/device/deviceStorage.ts', 'utf8');
  const edge = fs.readFileSync('supabase/functions/device-register/index.ts', 'utf8');
  const flags = fs.readFileSync('src/features/device/deviceFeatureFlags.ts', 'utf8');

  assert.match(registration, /existing-registration-recovered/);
  assert.match(registration, /interpretDeviceRegisterResponse/);
  assert.match(registration, /shouldMintNewDeviceSecret/);
  assert.match(activation, /event: 'status-complete'/);
  assert.match(storage, /PAIRING_INSTALLATION_ID_KEY/);
  assert.match(storage, /LEGACY_INSTALLATION_ID_KEY/);
  assert.match(edge, /recovered: true/);
  assert.match(edge, /errorCategory: 'invalid_device'/);
  assert.doesNotMatch(edge, /update\(\{ \.\.\.patch, device_secret_hash: secretHash \}\)/);
  assert.match(flags, /activationRequired: closedBetaMode/);
});
