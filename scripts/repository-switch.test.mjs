import assert from 'node:assert/strict';
import test from 'node:test';

import { createRepositoryBundle } from '../src/features/providers/providerBundle.ts';
import {
  createDefaultProviderState,
  normalizeProviderState,
  setDemoModeForTests,
} from '../src/features/providers/providerModel.ts';

test.before(() => setDemoModeForTests(true));
test.after(() => setDemoModeForTests(null));

test('Repository bundle resolves provider metadata without exposing credentials', () => {
  const provider = createDefaultProviderState().providers[0];
  const bundle = createRepositoryBundle(provider);

  assert.equal(bundle.providerId, 'demo-provider');
  assert.equal(bundle.providerName, 'Demo Provider');
  assert.equal(bundle.connectionType, 'mock');
  assert.equal('password' in bundle, false);
  assert.equal(bundle.streamUrlBuilder.buildLiveStreamUrl('101').includes('demo-provider'), true);
});

test('Repository bundle rejects providers with missing connection data', () => {
  assert.throws(
    () =>
      createRepositoryBundle({
        id: 'broken-provider',
        name: 'Broken Provider',
        status: 'offline',
        expirationLabel: 'Unknown',
        selected: false,
      }),
    /missing connection details/i,
  );
});

test('Provider normalization falls back to the first connected provider when selection is invalid', () => {
  const normalized = normalizeProviderState({
    version: 1,
    selectedProviderId: 'missing',
    providers: [
      {
        id: 'provider-a',
        name: 'Provider A',
        status: 'active',
        expirationLabel: 'Expiration unavailable',
        selected: false,
        connection: {
          type: 'xtream',
          baseUrl: 'https://provider-a.example',
          username: 'user-a',
          password: 'secret-a',
        },
      },
      {
        id: 'provider-b',
        name: 'Provider B',
        status: 'offline',
        expirationLabel: 'Unknown',
        selected: false,
        connection: {
          type: 'xtream',
          baseUrl: 'https://provider-b.example',
          username: 'user-b',
          password: 'secret-b',
        },
      },
    ],
  });

  assert.equal(normalized.selectedProviderId, 'provider-a');
  assert.equal(normalized.providers[0].selected, true);
  assert.equal(normalized.providers[1].selected, false);
});

test('Mock provider bundles expose ready state and safe account metadata placeholders', async () => {
  const provider = createDefaultProviderState().providers[0];
  const bundle = createRepositoryBundle(provider);
  await bundle.ready;

  assert.equal(bundle.accountMetadata, null);
  assert.equal(typeof bundle.invalidate, 'function');
});
