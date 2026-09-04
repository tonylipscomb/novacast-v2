import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8');

test('resolver terminal returns carry stable diagnostic branch labels', () => {
  const source = read('src/features/startup/resolveStartupProvider.ts');
  for (const branch of [
    'non-managed-flow',
    'already-active',
    'managed-refresh-success',
    'managed-refresh-failure',
    'provider-bundle-unavailable',
    'assignment-missing',
    'provider-missing',
  ]) {
    assert.match(source, new RegExp(`['"]${branch}['"]`));
  }
  assert.match(source, /resolverProviderBootstrapRequested/);
  assert.match(source, /bundlePresentAtReturn/);
});

test('StartupGate distinguishes resolver result from local bootstrapping state', () => {
  const source = read('src/features/startup/StartupGate.tsx');

  assert.match(source, /event: 'provider-resolution-returned'/);
  assert.match(source, /resolverProviderBootstrapRequested: result\.providerBootstrapRequested/);
  assert.match(source, /bootstrappingBeforeApply: true/);
  assert.match(source, /bootstrapping,/);
  assert.doesNotMatch(source, /providerBootstrapRequested: bootstrapping/);
});

test('bundle lifecycle markers surround the existing global publication points', () => {
  const source = read('src/features/providers/providerBundle.ts');
  const auditLogger = source.slice(
    source.indexOf('function logProviderBundleAudit'),
    source.indexOf('const listeners = new Set'),
  );

  assert.match(source, /activeBundle = bundle;[\s\S]*?logProviderBundleAudit\('bundle-activated'/);
  assert.match(source, /activeBundle = null;[\s\S]*?logProviderBundleAudit\('bundle-invalidated'/);
  assert.doesNotMatch(auditLogger, /username|password|baseUrl|rawError|rawResponse/);
});
