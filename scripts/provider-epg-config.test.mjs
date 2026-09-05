import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeProviderState } from '../src/features/providers/providerModel.ts';
import { buildXmltvSourceKey, createCustomXmltvSource } from '../src/features/guide/xmltv/xmltvSource.ts';
import {
  clearProviderCustomEpgUrl,
  getProviderCustomEpgUrl,
  setProviderCustomEpgUrl,
} from '../src/features/providers/providerEpgStore.ts';
import { setSecureValueStoreForTests } from '../src/features/providers/providerCredentialStore.ts';

test('provider EPG config defaults to provider mode without public URL state', () => {
  const state = normalizeProviderState({ version: 1, providers: [{ id: 'p1', name: 'Provider', status: 'active', selected: true, connection: { type: 'mock', serverId: 'p1' } }], selectedProviderId: 'p1' });
  assert.deepEqual(state.providers[0].epg, { mode: 'provider', customUrlConfigured: false });
  assert.equal('customEpgUrl' in state.providers[0], false);
});

test('custom EPG URL is securely scoped and supports get/set/clear', async () => {
  const values = new Map();
  setSecureValueStoreForTests({ getItem: async (key) => values.get(key) ?? null, setItem: async (key, value) => values.set(key, value), deleteItem: async (key) => values.delete(key) });
  await setProviderCustomEpgUrl('provider/one', 'https://epg.example.test/guide.xml?token=secret');
  assert.equal(await getProviderCustomEpgUrl('provider/one'), 'https://epg.example.test/guide.xml?token=secret');
  await clearProviderCustomEpgUrl('provider/one');
  assert.equal(await getProviderCustomEpgUrl('provider/one'), null);
  setSecureValueStoreForTests(null);
});

test('provider and custom XMLTV cache identities cannot collide', () => {
  const provider = buildXmltvSourceKey('p1', 'provider', 'https://provider.example');
  const custom = buildXmltvSourceKey('p1', 'custom', 'https://epg.example/guide.xml');
  assert.notEqual(provider, custom);
  assert.match(createCustomXmltvSource('p1', 'https://epg.example/guide.xml?token=secret').sourceKey, /^epg:/);
  assert.doesNotMatch(createCustomXmltvSource('p1', 'https://epg.example/guide.xml?token=secret').sourceKey, /secret/);
});
