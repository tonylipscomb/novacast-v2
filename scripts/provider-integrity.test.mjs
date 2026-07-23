import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDefaultProviderState,
  deriveProviderStatus,
  getSelectedProvider,
  hasSavedProvider,
  normalizeProviderState,
  serializeProviderState,
  setDemoModeForTests,
} from '../src/features/providers/providerModel.ts';
import {
  createMemoryCredentialStore,
  getProviderCredentials,
  setCredentialStoreForTests,
} from '../src/features/providers/providerCredentialStore.ts';
import {
  activateRepositoryBundle,
  getActiveRepositoryBundle,
  getRepositoryBundleGeneration,
  invalidateRepositoryBundle,
  setRepositoryBundleFactoryForTests,
  setRepositoryBundleActivationObserverForTests,
} from '../src/features/providers/providerBundle.ts';
import {
  clearProviderCacheForTests,
  connectXtreamProvider,
  getProviderRuntime,
  getProviderState,
  setProviderStateStorageForTests,
  switchActiveProvider,
} from '../src/features/providers/providerStore.ts';
import { formatProviderExpirationLabel } from '../src/features/providers/providerExpiration.ts';
import { getDevPairingPayload } from '../src/features/pairing/pairingBridge.ts';
import { isPairingCompleted, resetPairingCompleted } from '../src/features/pairing/pairingState.ts';
import { launchUnifiedPlayback, resetUnifiedPlayerForTests, getUnifiedPlayerState } from '../src/features/playback/unified/unifiedPlayerStore.ts';

const PROVIDER_STATE_KEY = '@novacast/provider-state';

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      values.set(key, value);
    },
    values,
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createFakeBundle(provider, options = {}) {
  const generation = getRepositoryBundleGeneration() + 1;
  return {
    providerId: provider.id,
    providerName: provider.name,
    connectionType: provider.connection?.type ?? 'xtream',
    generation,
    createdAt: Date.now(),
    accountMetadata: options.accountMetadata ?? {
      status: 'Active',
      expiresAt: Date.now() + 86400000,
      updatedAt: Date.now(),
    },
    ready: options.ready ?? Promise.resolve(),
    syncCatalog: options.syncCatalog ?? (async () => {}),
    invalidate() {
      options.onInvalidate?.();
    },
  };
}

let bundleMode = 'success';
let bundleReady = null;
let bundleSyncCalls = [];

function installFakeBundleFactory() {
  setRepositoryBundleFactoryForTests((provider) => {
    if (bundleMode === 'fail') {
      return createFakeBundle(provider, { ready: Promise.reject(new Error('fake validation failed')) });
    }

    const ready = bundleReady?.promise ?? Promise.resolve();
    const bundle = createFakeBundle(provider, {
      ready,
      syncCatalog: async () => {
        bundleSyncCalls.push(provider.id);
      },
    });
    return bundle;
  });
}

async function seedProviders(state = createDefaultProviderState()) {
  const storage = createStorage({ [PROVIDER_STATE_KEY]: serializeProviderState(state) });
  setProviderStateStorageForTests(storage);
  setCredentialStoreForTests(createMemoryCredentialStore());
  clearProviderCacheForTests();
  invalidateRepositoryBundle();
  bundleMode = 'success';
  bundleReady = null;
  bundleSyncCalls = [];
  installFakeBundleFactory();
  await getProviderState();
  return storage;
}

test.beforeEach(async () => {
  setDemoModeForTests(true);
  resetUnifiedPlayerForTests();
  await seedProviders();
});

test.afterEach(() => {
  invalidateRepositoryBundle();
  clearProviderCacheForTests();
  setRepositoryBundleFactoryForTests(null);
  setRepositoryBundleActivationObserverForTests(null);
  setCredentialStoreForTests(null);
  setProviderStateStorageForTests(null);
  setDemoModeForTests(null);
});

test('production normalization keeps incomplete providers invalid and never fabricates demo connections', () => {
  setDemoModeForTests(false);
  const normalized = normalizeProviderState({
    version: 1,
    selectedProviderId: 'demo-provider',
    providers: [
      {
        id: 'demo-provider',
        name: 'Demo Provider',
        status: 'active',
        selected: true,
        connection: { type: 'mock', baseUrl: 'https://demo.invalid', username: 'demo', password: 'demo' },
      },
      { id: 'incomplete', name: 'Incomplete', status: 'active', selected: false },
    ],
  });

  assert.equal(normalized.providers.length, 2);
  assert.equal(normalized.providers[0].connection, undefined);
  assert.equal(normalized.providers[1].connection, undefined);
  assert.equal(hasSavedProvider(normalized), false);
  assert.equal(normalized.selectedProviderId, '');
  assert.equal(createDefaultProviderState().providers.length, 0);
});

test('public provider serialization contains no credentials, URL credentials, or raw account response', () => {
  const serialized = serializeProviderState(
    normalizeProviderState({
      version: 1,
      selectedProviderId: 'provider-a',
      providers: [
        {
          id: 'provider-a',
          name: 'Provider A',
          status: 'active',
          selected: true,
          connection: {
            type: 'xtream',
            baseUrl: 'https://provider.example',
            username: 'private-user',
            password: 'private-password',
          },
          account: {
            status: 'Active',
            expiresAt: Date.now() + 1000,
            raw: { user_info: { password: 'private-password' } },
          },
        },
      ],
    }),
  );

  assert.equal(serialized.includes('private-password'), false);
  assert.equal(serialized.includes('private-user'), false);
  assert.equal(serialized.includes('raw'), false);
  assert.equal(serialized.includes('/movie/'), false);
});

test('legacy inline credentials migrate to the credential store and write sanitized metadata', async () => {
  const storage = createStorage({
    [PROVIDER_STATE_KEY]: JSON.stringify({
      version: 1,
      selectedProviderId: 'legacy-provider',
      providers: [
        {
          id: 'legacy-provider',
          name: 'Legacy Provider',
          status: 'active',
          selected: true,
          connection: {
            type: 'xtream',
            baseUrl: 'https://legacy.example',
            username: 'legacy-user',
            password: 'legacy-password',
          },
        },
      ],
    }),
  });
  const credentials = createMemoryCredentialStore();
  setProviderStateStorageForTests(storage);
  setCredentialStoreForTests(credentials);
  clearProviderCacheForTests();

  const state = await getProviderState();
  const stored = storage.values.get(PROVIDER_STATE_KEY);
  const migrated = await getProviderCredentials('legacy-provider');

  assert.equal(state.selectedProviderId, 'legacy-provider');
  assert.deepEqual(migrated, {
    type: 'xtream',
    baseUrl: 'https://legacy.example',
    username: 'legacy-user',
    password: 'legacy-password',
  });
  assert.equal(stored.includes('legacy-password'), false);
  assert.equal(stored.includes('legacy-user'), false);
  assert.equal(stored.includes('baseUrl'), false);
});

test('expired metadata and unknown expiration stay truthful', () => {
  assert.equal(deriveProviderStatus({ status: 'Active', expiresAt: Date.now() - 1000 }), 'expired');
  assert.equal(formatProviderExpirationLabel({ id: 'unknown', name: 'Unknown', status: 'unknown', selected: false }, null), 'Expiration unavailable');
});

test('adding Provider B preserves Provider A and repeated add updates the deterministic duplicate', async () => {
  await seedProviders();
  const providerA = getSelectedProvider(await getProviderState());
  activateRepositoryBundle(createFakeBundle(providerA, { accountMetadata: null }));
  const initialProviderCount = (await getProviderState()).providers.length;

  const first = await connectXtreamProvider({
    name: 'Provider B',
    baseUrl: 'https://provider-b.example/',
    username: 'user-b',
    password: 'password-b',
  });
  const providerBId = first.providers.find((provider) => provider.name === 'Provider B')?.id;
  assert.ok(providerBId);
  assert.deepEqual((await getProviderCredentials(providerBId)).type, 'xtream');
  assert.equal(first.providers.length, initialProviderCount + 1);
  assert.equal(first.providers.some((provider) => provider.id === providerA.id), true);

  const second = await connectXtreamProvider({
    name: 'Provider B Renamed',
    baseUrl: 'https://provider-b.example',
    username: 'user-b',
    password: 'password-b',
  });
  assert.equal(second.providers.length, initialProviderCount + 1);
  assert.equal(second.providers.filter((provider) => provider.id === providerBId).length, 1);
  assert.equal(second.providers.find((provider) => provider.id === providerBId)?.name, 'Provider B Renamed');
});

test('candidate validation does not activate early and failed add preserves the old provider and bundle', async () => {
  const providerA = getSelectedProvider(await getProviderState());
  activateRepositoryBundle(createFakeBundle(providerA, { accountMetadata: null }));
  const readiness = createDeferred();
  bundleReady = readiness;

  const operation = connectXtreamProvider({
    name: 'Provider B',
    baseUrl: 'https://provider-b.example',
    username: 'user-b',
    password: 'password-b',
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(getActiveRepositoryBundle()?.providerId, providerA.id);

  readiness.resolve();
  await operation;
  assert.equal(getActiveRepositoryBundle()?.providerId.startsWith('xtream-'), true);

  bundleMode = 'fail';
  const before = await getProviderState();
  const activeBefore = getActiveRepositoryBundle()?.providerId;
  await assert.rejects(
    connectXtreamProvider({
      name: 'Provider C',
      baseUrl: 'https://provider-c.example',
      username: 'user-c',
      password: 'password-c',
    }),
  );
  const after = await getProviderState();
  assert.deepEqual(after.providers.map((provider) => provider.id), before.providers.map((provider) => provider.id));
  assert.equal(getActiveRepositoryBundle()?.providerId, activeBefore);
  assert.equal(await getProviderCredentials('xtream-provider-c'), null);
});

test('failed switching preserves selected provider, active bundle, and public generation', async () => {
  const state = await getProviderState();
  const providerA = getSelectedProvider(state);
  const providerB = {
    id: 'provider-b',
    name: 'Provider B',
    status: 'unknown',
    expirationAt: null,
    selected: false,
    connection: { type: 'xtream', serverId: 'https://provider-b.example', credentialKey: 'provider-b' },
  };
  const nextState = { ...state, providers: [...state.providers, providerB] };
  const storage = createStorage({ [PROVIDER_STATE_KEY]: serializeProviderState(nextState) });
  setProviderStateStorageForTests(storage);
  setCredentialStoreForTests(createMemoryCredentialStore({
    'provider-b': { type: 'xtream', baseUrl: 'https://provider-b.example', username: 'user-b', password: 'password-b' },
  }));
  clearProviderCacheForTests();
  await getProviderState();
  activateRepositoryBundle(createFakeBundle(providerA, { accountMetadata: null }));
  const generation = getProviderRuntime().generation;
  bundleMode = 'fail';

  await assert.rejects(() => switchActiveProvider('provider-b'));
  const after = await getProviderState();
  assert.equal(after.selectedProviderId, providerA.id);
  assert.equal(getActiveRepositoryBundle()?.providerId, providerA.id);
  assert.equal(getProviderRuntime().generation, generation);
});

test('successful switch closes unified playback before exposing the new bundle', async () => {
  const state = await getProviderState();
  const providerA = getSelectedProvider(state);
  const providerB = {
    id: 'provider-b',
    name: 'Provider B',
    status: 'unknown',
    expirationAt: null,
    selected: false,
    connection: { type: 'xtream', serverId: 'https://provider-b.example', credentialKey: 'provider-b' },
  };
  const storage = createStorage({ [PROVIDER_STATE_KEY]: serializeProviderState({ ...state, providers: [...state.providers, providerB] }) });
  setProviderStateStorageForTests(storage);
  setCredentialStoreForTests(createMemoryCredentialStore({
    'provider-b': { type: 'xtream', baseUrl: 'https://provider-b.example', username: 'user-b', password: 'password-b' },
  }));
  clearProviderCacheForTests();
  await getProviderState();
  activateRepositoryBundle(createFakeBundle(providerA, { accountMetadata: null }));
  launchUnifiedPlayback({ id: 'movie-1', providerId: providerA.id, mediaType: 'movie', title: 'Movie', streamUrl: 'https://safe.invalid/movie.mp4' });

  let activationSawPlaybackClosed = false;
  setRepositoryBundleActivationObserverForTests(() => {
    activationSawPlaybackClosed = getUnifiedPlayerState().item === null;
  });
  await switchActiveProvider('provider-b');
  assert.equal(getUnifiedPlayerState().item, null);
  assert.equal(activationSawPlaybackClosed, true);
  assert.equal(getActiveRepositoryBundle()?.providerId, 'provider-b');
});

test('release pairing cannot report completion or bootstrap development credentials', () => {
  resetPairingCompleted();
  assert.equal(isPairingCompleted(), false);
  assert.equal(getDevPairingPayload(), null);
});

test('old bundle catalog completion cannot publish after a new bundle becomes active', async () => {
  const providerA = getSelectedProvider(await getProviderState());
  const providerB = { ...providerA, id: 'provider-b', name: 'Provider B' };
  activateRepositoryBundle(createFakeBundle(providerA, { accountMetadata: null, syncCatalog: async () => bundleSyncCalls.push('old') }));
  activateRepositoryBundle(createFakeBundle(providerB, { accountMetadata: null, syncCatalog: async () => bundleSyncCalls.push('new') }));
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(bundleSyncCalls.includes('old'), false);
  assert.equal(bundleSyncCalls.includes('new'), true);
});
