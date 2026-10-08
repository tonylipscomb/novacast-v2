import { isDeviceAuthorizationActive } from './device.ts';

const past = '2020-01-01T00:00:00.000Z';
const future = '2099-01-01T00:00:00.000Z';

const device = (overrides: Record<string, string | null> = {}) => ({
  status: 'active',
  activation_status: 'active',
  ...overrides,
});

const activation = (overrides: Record<string, string | null> = {}) => ({
  status: 'active',
  expires_at: future,
  activation_source: 'invite',
  ...overrides,
});

Deno.test('production activation remains authorized after historical expiry', () => {
  if (!isDeviceAuthorizationActive(device(), activation({ expires_at: past, activation_source: 'production' }), Date.parse('2026-01-01T00:00:00.000Z'))) {
    throw new Error('production activation was incorrectly expired');
  }
});

Deno.test('production activation with no expiry remains authorized', () => {
  if (!isDeviceAuthorizationActive(device(), activation({ expires_at: null, activation_source: 'production' }))) {
    throw new Error('production activation without expiry was rejected');
  }
});

Deno.test('production activation still fails closed for revoked, suspended, or inactive state', () => {
  for (const status of ['revoked', 'suspended']) {
    if (isDeviceAuthorizationActive(device(), activation({ status, activation_source: 'production' }))) {
      throw new Error(`${status} activation was authorized`);
    }
  }
  if (isDeviceAuthorizationActive(device({ status: 'inactive' }), activation({ activation_source: 'production' }))) {
    throw new Error('inactive production device was authorized');
  }
});

Deno.test('legacy beta activation still expires by expires_at', () => {
  if (isDeviceAuthorizationActive(device(), activation({ expires_at: past, activation_source: 'invite' }), Date.parse('2026-01-01T00:00:00.000Z'))) {
    throw new Error('legacy expired activation was authorized');
  }
});

Deno.test('legacy registered active activation behavior remains supported', () => {
  if (!isDeviceAuthorizationActive(device({ status: 'registered' }), activation())) {
    throw new Error('legacy registered device behavior changed');
  }
});
