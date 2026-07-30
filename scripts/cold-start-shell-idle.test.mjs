import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('Home disables continuous navbar preferred focus when a Home card owns first focus', async () => {
  const home = await fs.readFile(new URL('../src/features/hub/MainMenuScreen.tsx', import.meta.url), 'utf8');
  assert.match(home, /preferActiveNavigationFocus=\{!firstHomeFocusId\}/);
  assert.match(home, /preferredFocusConsumedRef/);
  assert.match(home, /hasTVPreferredFocus=\{preferredFocus && !preferredFocusConsumedRef\.current\}/);
});

test('NovaTvShell isolates beta countdown from shell/children re-renders', async () => {
  const shell = await fs.readFile(new URL('../src/components/nova/NovaTvShell.tsx', import.meta.url), 'utf8');
  assert.match(shell, /function ShellBetaExpiration/);
  assert.match(shell, /function ShellHeaderClock/);
  const shellBody = shell.split('export function NovaTvShell')[1] ?? '';
  assert.doesNotMatch(shellBody, /useAccessExpirationDisplay/);
  assert.match(shell, /function ShellBetaExpiration[\s\S]*useAccessExpirationDisplay/);
});

test('catalog sync idle-yields even when playback is inactive', async () => {
  const sync = await fs.readFile(new URL('../src/features/providers/providerCatalogSync.ts', import.meta.url), 'utf8');
  assert.match(
    sync,
    /if \(!shouldYieldCatalogSync\(\)\) \{\s*await waitForCatalogSyncIdleSlot\(\);/s,
  );
});
