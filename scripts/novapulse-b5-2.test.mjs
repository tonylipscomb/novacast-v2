import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const read = (path) => fs.readFileSync(path, 'utf8');
const health = read('src/features/providers/providerHealth.ts');
const signals = read('src/features/providers/providerHealthSignals.ts');
const types = read('src/features/novapulse/novaPulseTypes.ts');
const sources = read('src/features/novapulse/novaPulseSources.ts');
const logic = read('src/features/novapulse/novaPulseLogic.ts');
const card = read('src/features/novapulse/NovaPulseCard.tsx');
const composition = read('src/features/novapulse/novaPulseV2.ts');
const feed = read('src/features/novapulse/useNovaPulseFeed.ts');
const bundle = read('src/features/providers/providerBundle.ts');
const store = read('src/features/providers/providerStore.ts');
const sync = read('src/features/providers/providerCatalogSync.ts');

function loadProviderHealthForBehavioralTest() {
  const source = read('src/features/providers/providerHealth.ts')
    .replace("import { useEffect, useState } from 'react';", "const useEffect = () => undefined; const useState = (initial) => [typeof initial === 'function' ? initial() : initial, () => undefined];")
    .replace("import AsyncStorage from '@react-native-async-storage/async-storage';", 'const AsyncStorage = globalThis.__asyncStorage;');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, globalThis: { __asyncStorage: { getItem: async () => null, setItem: async () => undefined } }, process: { env: { EXPO_PUBLIC_NOVAPULSE_PROVIDER_HEALTH_ENABLED: 'true' } }, console });
  return module.exports;
}

test('disabled provider health has a zero-work path', () => {
  assert.match(health, /EXPO_PUBLIC_NOVAPULSE_PROVIDER_HEALTH_ENABLED === 'true'/);
  assert.match(health, /if \(!NOVA_PULSE_PROVIDER_HEALTH_ENABLED \|\| loaded\) return/);
  assert.match(health, /if \(!NOVA_PULSE_PROVIDER_HEALTH_ENABLED\) return/);
  assert.match(health, /NOVA_PULSE_PROVIDER_HEALTH_STORAGE_KEY/);
});

test('storage is versioned, bounded, pruned, and local-only', () => {
  assert.match(health, /PROVIDER_HEALTH_VERSION = 1/);
  assert.match(health, /PROVIDER_HEALTH_MAX_PROVIDERS = 16/);
  assert.match(health, /PROVIDER_HEALTH_MAX_OBSERVATIONS = 16/);
  assert.match(health, /PROVIDER_HEALTH_STATE_RETENTION_MS = 7 \* 24/);
  assert.match(health, /PROVIDER_HEALTH_ACTIVE_ALERT_MAX_MS = 60 \* 60/);
  assert.match(health, /JSON\.stringify\(payload\)/);
  for (const forbidden of ['baseUrl', 'username', 'password', 'streamUrl', 'playlistUrl', 'rawResponse']) assert.doesNotMatch(health, new RegExp(`\\b${forbidden}\\b`));
});

test('failure thresholds and explicit states are distinct', () => {
  assert.match(health, /failures >= 5.*'unavailable'/s);
  assert.match(health, /failures >= 3.*'degraded'/s);
  assert.match(signals, /authentication_required/);
  assert.match(signals, /subscription_expired/);
  assert.match(signals, /generic/);
  assert.doesNotMatch(signals, /status === 401/);
});

test('provider health helpers execute threshold, dedupe, generation, expiry, and recovery transitions', async () => {
  const healthModule = loadProviderHealthForBehavioralTest();
  const now = 1_800_000_000_000;
  healthModule.resetProviderHealthForTests();
  healthModule.setProviderHealthGeneration('opaque-provider', 7);
  for (let index = 0; index < 3; index += 1) {
    assert.equal(await healthModule.recordProviderHealthSignal({ providerId: 'opaque-provider', generation: 7, operationId: `failure-${index}`, kind: 'failure', nowMs: now + index }), true);
  }
  assert.equal(healthModule.getProviderHealthSnapshot('opaque-provider', 7, now + 3).status, 'degraded');
  assert.equal(await healthModule.recordProviderHealthSignal({ providerId: 'opaque-provider', generation: 7, operationId: 'failure-2', kind: 'failure', nowMs: now + 4 }), false);
  assert.equal(await healthModule.recordProviderHealthSignal({ providerId: 'opaque-provider', generation: 6, operationId: 'stale', kind: 'failure', nowMs: now + 5 }), false);
  assert.equal(await healthModule.recordProviderHealthSignal({ providerId: 'opaque-provider', generation: 7, operationId: 'failure-3', kind: 'failure', nowMs: now + 6 }), true);
  assert.equal(await healthModule.recordProviderHealthSignal({ providerId: 'opaque-provider', generation: 7, operationId: 'failure-4', kind: 'failure', nowMs: now + 7 }), true);
  assert.equal(healthModule.getProviderHealthSnapshot('opaque-provider', 7, now + 8).status, 'unavailable');
  assert.equal(await healthModule.recordProviderHealthSignal({ providerId: 'opaque-provider', generation: 7, operationId: 'success-1', kind: 'success', nowMs: now + 9 }), true);
  assert.equal(await healthModule.recordProviderHealthSignal({ providerId: 'opaque-provider', generation: 7, operationId: 'success-2', kind: 'success', nowMs: now + 10 }), true);
  const recovered = healthModule.getProviderHealthSnapshot('opaque-provider', 7, now + 11);
  assert.equal(recovered.status, 'recovered');
  assert.equal(recovered.expiresAt, now + 10 + 10 * 60_000);
  assert.equal(healthModule.getProviderHealthSnapshot('opaque-provider', 7, now + 11 + 10 * 60_000 + 1).status, 'unknown');
});

test('provider health persistence is bounded and storage failures remain nonfatal', async () => {
  let stored = null;
  const healthModule = loadProviderHealthForBehavioralTest();
  healthModule.setProviderHealthStorageForTests({ getItem: async () => stored, setItem: async (_key, value) => { stored = value; } });
  const now = 1_800_000_000_000;
  for (let index = 0; index < 20; index += 1) {
    healthModule.setProviderHealthGeneration(`provider-${index}`, 1);
    await healthModule.recordProviderHealthSignal({ providerId: `provider-${index}`, generation: 1, operationId: `success-${index}`, kind: 'success', nowMs: now + index });
  }
  const persisted = JSON.parse(stored);
  assert.equal(Object.keys(persisted.providers).length, 16);
  const failing = loadProviderHealthForBehavioralTest();
  failing.setProviderHealthStorageForTests({ getItem: async () => null, setItem: async () => { throw new Error('storage failure'); } });
  failing.setProviderHealthGeneration('provider', 1);
  await assert.doesNotReject(() => failing.recordProviderHealthSignal({ providerId: 'provider', generation: 1, operationId: 'write-failure', kind: 'success', nowMs: now }));
});

test('provider removal clears only the removed provider health state', () => {
  assert.match(health, /export async function clearProviderHealth\(providerId: string\)/);
  assert.match(store, /clearProviderHealth\(provider\.id\)/);
});

test('explicit authentication state requires current-session success evidence to recover', async () => {
  const healthModule = loadProviderHealthForBehavioralTest();
  const now = 1_800_000_000_000;
  healthModule.resetProviderHealthForTests();
  healthModule.setProviderHealthGeneration('explicit-provider', 3);
  await healthModule.recordProviderHealthSignal({ providerId: 'explicit-provider', generation: 3, operationId: 'auth-failure', kind: 'failure', explicit: 'authentication_required', nowMs: now });
  assert.equal(healthModule.getProviderHealthSnapshot('explicit-provider', 3, now + 1).status, 'authentication_required');
  await healthModule.recordProviderHealthSignal({ providerId: 'explicit-provider', generation: 3, operationId: 'success-1', kind: 'success', nowMs: now + 2 });
  await healthModule.recordProviderHealthSignal({ providerId: 'explicit-provider', generation: 3, operationId: 'success-2', kind: 'success', nowMs: now + 3 });
  assert.equal(healthModule.getProviderHealthSnapshot('explicit-provider', 3, now + 4).status, 'recovered');
});

test('future and malformed persisted timestamps are rejected during hydration', async () => {
  const now = 1_800_000_000_000;
  const futurePayload = JSON.stringify({ version: 1, providers: { provider: { version: 1, generation: 1, status: 'unavailable', changedAt: now + 3 * 24 * 60 * 60_000, notificationAt: null, expiresAt: null, observations: [] } } });
  const healthModule = loadProviderHealthForBehavioralTest();
  healthModule.setProviderHealthStorageForTests({ getItem: async () => futurePayload, setItem: async () => undefined });
  await healthModule.hydrateProviderHealth(now);
  assert.equal(healthModule.getProviderHealthSnapshot('provider', 1, now).status, 'unknown');
});

test('operation deduplication, cancellation, offline suppression, and generation guards exist', () => {
  assert.match(health, /operationId === input\.operationId\.trim\(\)/);
  assert.match(health, /input\.cancelled \|\| input\.offline/);
  assert.match(health, /activeGeneration != null && activeGeneration !== input\.generation/);
  assert.match(health, /setProviderHealthGeneration/);
});

test('success and recovery lifetimes are bounded', () => {
  assert.match(health, /successes >= 2/);
  assert.match(health, /'recovered'/);
  assert.match(health, /PROVIDER_HEALTH_RECOVERED_MAX_MS/);
  assert.match(health, /PROVIDER_HEALTH_NOTIFICATION_COOLDOWN_MS/);
});

test('safe provider alert wording and non-actionable mapping are present', () => {
  for (const text of ['Provider Service Issue', 'Provider Temporarily Unavailable', 'Provider Sign-In Needed', 'Provider Subscription Expired', 'Provider Service Restored', 'PROVIDER ALERT']) assert.match(`${sources}\n${card}`, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(types, /'provider_alert'/);
  assert.match(sources, /action: \{ type: 'none' \}/);
  assert.match(card, /const action = providerAlert \? null/);
});

test('provider alerts are bounded separately from announcements and preserve rail caps', () => {
  assert.match(composition, /urgentProviderAlert/);
  assert.match(composition, /recoveredProviderAlert/);
  assert.match(composition, /provider_alert/);
  assert.match(composition, /NOVA_PULSE_V2_MAX_ITEMS = 12/);
  assert.match(composition, /slice\(0, 2\)/);
  assert.match(feed, /createNovaPulseProviderHealthSource/);
});

test('provider identity/generation comes from existing local runtime conventions', () => {
  assert.match(bundle, /healthGeneration/);
  assert.match(sync, /healthGeneration\?: number/);
  assert.match(sync, /setProviderHealthGeneration\(input\.providerId, input\.healthGeneration\)/);
  assert.match(store, /setProviderHealthGeneration\(selectedProvider\.id, bundleGeneration\)/);
});

test('signals use existing account/catalog operations only', () => {
  assert.match(bundle, /recordProviderHealthSuccess/);
  assert.match(bundle, /recordProviderHealthFailure/);
  assert.match(bundle, /scheduleProviderCatalogSync/);
  assert.doesNotMatch(health, /fetch\s*\(/);
  assert.doesNotMatch(signals, /fetch\s*\(/);
});

test('cached catalog completion is not reported as verified provider success', () => {
  const syncCatalogBody = bundle.slice(bundle.indexOf('syncCatalog:'), bundle.indexOf('export function createRepositoryBundle'));
  assert.doesNotMatch(syncCatalogBody, /recordProviderHealthSuccess/);
  assert.match(bundle, /getAccountInfo\(\)[\s\S]*recordProviderHealthSuccess/);
});

test('provider-health cards are excluded from announcement/history semantics', () => {
  assert.match(sources, /sourceId: 'provider-health'/);
  assert.match(composition, /item\.type !== 'announcement' && item\.type !== 'provider_alert'/);
  assert.match(feed, /recordNovaPulseSelection/);
  assert.match(composition, /item\.type === 'movie' \|\| item\.type === 'series'/);
});

test('the reconstructed file set is present and no remote provider health request was added', () => {
  const expected = [
    '.env.example',
    'src/features/providers/providerHealth.ts',
    'src/features/providers/providerHealthSignals.ts',
    'src/features/providers/providerBundle.ts',
    'src/features/providers/providerStore.ts',
    'src/features/providers/providerCatalogSync.ts',
    'src/features/novapulse/novaPulseTypes.ts',
    'src/features/novapulse/novaPulseSources.ts',
    'src/features/novapulse/novaPulseLogic.ts',
    'src/features/novapulse/NovaPulseCard.tsx',
    'src/features/novapulse/novaPulseV2.ts',
    'src/features/novapulse/useNovaPulseFeed.ts',
    'scripts/novapulse-b5-2.test.mjs',
  ];
  for (const path of expected) assert.equal(fs.existsSync(path), true, path);
  assert.doesNotMatch(health, /https?:\/\//);
  assert.doesNotMatch(signals, /https?:\/\//);
});
