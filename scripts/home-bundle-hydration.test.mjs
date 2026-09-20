import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8');

test('Home uses stale-while-revalidate hydration and refreshes on route return', () => {
  const home = read('src/features/hub/MainMenuScreen.tsx');
  assert.match(home, /generation: providerBundleGeneration/);
  assert.match(home, /useFocusEffect\(/);
  assert.match(home, /loadHomePersonalization\(providerId, bundleRef\.current\)/);
  assert.match(home, /homeFocusedRef\.current/);
  assert.match(home, /homeHydratedRef\.current/);
  assert.match(home, /homeRefreshInFlightRef\.current/);
  assert.match(home, /homeRefreshQueuedRef\.current/);
  assert.match(home, /Stale-while-revalidate/);
  assert.doesNotMatch(home, /useEffect\(\(\) => \{[\s\S]{0,900}loadHomePersonalization\(activeProviderId, bundle\)[\s\S]{0,900}\}, \[activeProviderId, bundle, providerBundleGeneration\]\)/);
});

test('repository activation notifies subscribers without requiring a provider-id change', () => {
  const bundle = read('src/features/providers/providerBundle.ts');
  assert.match(bundle, /activeBundle = bundle;[\s\S]*?notify\(\);/);
  assert.match(bundle, /export function subscribeRepositoryBundle/);
});
