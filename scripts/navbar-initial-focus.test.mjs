import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  isFullScreenLayout,
  shouldRestoreStartupFocus,
} from '../src/features/navigation/navbarInitialFocus.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8');

test('startup focus restores once after terminal full-screen layout', () => {
  assert.equal(isFullScreenLayout({ width: 960, height: 399.5, windowWidth: 960, windowHeight: 540 }), false);
  assert.equal(isFullScreenLayout({ width: 960, height: 540, windowWidth: 960, windowHeight: 540 }), true);
  assert.equal(shouldRestoreStartupFocus({ activeId: 'home', providerBootstrapTerminal: true, fullScreenLayout: true, userInteracted: false, restoreRequested: false }), true);
  assert.equal(shouldRestoreStartupFocus({ activeId: 'home', providerBootstrapTerminal: true, fullScreenLayout: true, userInteracted: true, restoreRequested: false }), false);
  assert.equal(shouldRestoreStartupFocus({ activeId: 'home', providerBootstrapTerminal: true, fullScreenLayout: true, userInteracted: false, restoreRequested: true }), false);
  const shell = read('src/components/nova/NovaTvShell.tsx');
  for (const event of ['startup-focus-final-layout-ready', 'startup-focus-user-interacted', 'startup-focus-restore-requested', 'startup-focus-restored', 'startup-focus-restore-skipped']) {
    assert.match(shell, new RegExp(event));
  }
});
