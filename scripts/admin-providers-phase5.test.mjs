import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const backend = fs.readFileSync(new URL('../supabase/functions/admin-providers/index.ts', import.meta.url), 'utf8');
const cloud = fs.readFileSync(new URL('../pairing-web/src/AdminCloud.tsx', import.meta.url), 'utf8');
const providers = fs.readFileSync(new URL('../pairing-web/src/AdminProviders.tsx', import.meta.url), 'utf8');

test('provider operations endpoint is authenticated, bounded, and paginated', () => {
  assert.match(backend, /await requireAdmin\(request\)/);
  assert.match(backend, /pageSize = Math\.min\(50/);
  assert.match(backend, /\.range\(from, from \+ queryOptions\.pageSize - 1\)/);
  assert.match(backend, /totalPages/);
  assert.match(backend, /order\('created_at'.*order\('id'/s);
});

test('provider search covers identity and assigned device references without exposing credentials', () => {
  assert.match(backend, /display_name\.ilike/);
  assert.match(backend, /slug\.ilike/);
  assert.match(backend, /public_device_code\.ilike/);
  assert.match(backend, /friendly_name\.ilike/);
  assert.match(backend, /assignedDeviceSamples/);
  const publicLoader = backend.slice(backend.indexOf('async function loadPublicProviders'), backend.indexOf('function isMissingGoldMetadataError'));
  assert.doesNotMatch(publicLoader, /credentials_ciphertext|credentials_iv|password/);
  assert.doesNotMatch(providers, /credentials_ciphertext|credentials_iv/);
});

test('provider filters include health, type/source, and Gold linkage', () => {
  for (const field of ['health', 'type', 'managed', 'gold']) assert.match(backend, new RegExp(`queryOptions\\.${field}`));
  for (const label of ['All health states', 'All types', 'All sources', 'All Gold states']) assert.match(providers, new RegExp(label));
});

test('assignment/device relationships use one page-level relation query', () => {
  assert.match(backend, /device_provider_assignments.*devices\(public_device_code,friendly_name\)/s);
  assert.doesNotMatch(backend, /for \(const provider of providerRows\)[\s\S]*?from\('device_provider_assignments'\)/);
});

test('Admin UI exposes bounded provider counts and deterministic page controls', () => {
  assert.match(cloud, /adminProvidersPath/);
  assert.match(cloud, /setProviderPagination/);
  assert.match(providers, /of \{pagination\.total\} providers/);
  assert.match(providers, /assignedDevices/);
  assert.match(providers, /goldAccount/);
});

test('Gold and provider operational actions remain existing actions', () => {
  assert.match(providers, /action: 'test'/);
  assert.match(providers, /action: 'activate'/);
  assert.match(providers, /action: 'disable'/);
  assert.doesNotMatch(providers, /delete_provider|assign_provider/);
});
