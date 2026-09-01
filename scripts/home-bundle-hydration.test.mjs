import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8');

test('Home rehydrates when the same provider bundle generation activates', () => {
  const home = read('src/features/hub/MainMenuScreen.tsx');
  assert.match(home, /generation: providerBundleGeneration/);
  assert.match(home, /loadHomePersonalization\(activeProviderId, bundle\)/);
  assert.match(home, /\[activeProviderId, bundle, providerBundleGeneration\]/);
});

test('repository activation notifies subscribers without requiring a provider-id change', () => {
  const bundle = read('src/features/providers/providerBundle.ts');
  assert.match(bundle, /activeBundle = bundle;[\s\S]*?notify\(\);/);
  assert.match(bundle, /export function subscribeRepositoryBundle/);
});
