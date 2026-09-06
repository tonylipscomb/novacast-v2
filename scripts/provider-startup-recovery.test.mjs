import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8');

test('already-active startup clears stale provider error only after identity validation', () => {
  const resolver = read('src/features/startup/resolveStartupProvider.ts');
  assert.match(resolver, /clearProviderSwitchError/);
  assert.match(resolver, /activeBundle\.providerId === selected\.id/);
  assert.match(resolver, /if \(alreadyActive\) \{[\s\S]*?clearProviderSwitchError\(\);/);
  assert.match(resolver, /providerBootstrapRequested: false/);
});

test('retry uses the centralized resolver instead of a separate cleanup path', () => {
  const resolver = read('src/features/startup/resolveStartupProvider.ts');
  const startupScreen = read('src/features/startup/ProviderInitErrorScreen.tsx');
  assert.match(startupScreen, /resolveStartupProvider\(\{ source: 'retry' \}\)/);
  assert.doesNotMatch(startupScreen, /clearProviderSwitchError/);
  assert.match(resolver, /const isRetry = source === 'retry'/);
});

test('invalid or mismatched active state does not clear the provider error', () => {
  const resolver = read('src/features/startup/resolveStartupProvider.ts');
  const alreadyActiveStart = resolver.indexOf('const alreadyActive =');
  const alreadyActiveEnd = resolver.indexOf('if (alreadyActive)', alreadyActiveStart);
  const condition = resolver.slice(alreadyActiveStart, alreadyActiveEnd);
  assert.match(condition, /activeBundle && selected && activeBundle\.providerId === selected\.id/);
  assert.match(condition, /isProviderConnectionReady\(selected\)/);
  assert.equal(resolver.slice(alreadyActiveEnd, resolver.indexOf('if (!flags.requiresProviderDownload)', alreadyActiveEnd)).match(/clearProviderSwitchError\(\)/g)?.length, 1);
});
