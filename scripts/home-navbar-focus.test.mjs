import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  resolveHomeNavbarRightTarget,
  shouldRetainNavbarFocus,
} from '../src/features/hub/homeNavbarFocus.ts';
import {
  DISCOVERY_ZONE_ORIGIN,
  shouldRestoreBrowseFocusAfterDetailClose,
  shouldReturnToDiscoverZone,
} from '../src/features/personalization/discoverZoneNavigation.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8');

test('empty or unmounted Home rows are not DPAD RIGHT destinations', () => {
  assert.deepEqual(
    resolveHomeNavbarRightTarget({ firstVisibleHomeTargetId: null, contentHandle: null }),
    { targetAvailable: false, targetId: null, nextFocusMode: 'retain-navbar' },
  );
  assert.deepEqual(
    resolveHomeNavbarRightTarget({ firstVisibleHomeTargetId: 'continue-1', contentHandle: null }),
    { targetAvailable: false, targetId: null, nextFocusMode: 'retain-navbar' },
  );
  assert.equal(
    shouldRetainNavbarFocus(
      resolveHomeNavbarRightTarget({ firstVisibleHomeTargetId: '', contentHandle: 12 }),
    ),
    true,
  );
});

test('a live mounted Home card is a valid navbar RIGHT target', () => {
  assert.deepEqual(
    resolveHomeNavbarRightTarget({
      firstVisibleHomeTargetId: 'continue-abc',
      contentHandle: 44,
    }),
    { targetAvailable: true, targetId: 'continue-abc', nextFocusMode: 'content' },
  );
});

test('walkthrough does not install a navbar RIGHT trap', () => {
  assert.equal(
    resolveHomeNavbarRightTarget({
      firstVisibleHomeTargetId: null,
      contentHandle: null,
      walkthroughVisible: true,
    }).nextFocusMode,
    'unmanaged',
  );
});

test('Home wires navbar RIGHT to a live card or retains navbar focus', () => {
  const hub = read('src/features/hub/MainMenuScreen.tsx');
  const shell = read('src/components/nova/NovaTvShell.tsx');
  assert.match(hub, /navigationContentFocusHandle/);
  assert.match(hub, /navigationNextFocusRight/);
  assert.match(hub, /right-from-navbar|logHomeNavbarRightAttempt/);
  assert.match(hub, /retained-navbar-focus|logHomeNavbarFocusRetained/);
  assert.match(shell, /onNavigationItemFocus/);
  assert.match(shell, /nextFocusRight: navigationNextFocusRight/);
});

test('Discovery Zone origin returns to Discovery Zone, not browse', () => {
  assert.equal(shouldReturnToDiscoverZone(DISCOVERY_ZONE_ORIGIN), true);
  assert.equal(shouldReturnToDiscoverZone('browse'), false);
  assert.equal(shouldReturnToDiscoverZone('series'), false);
  assert.equal(shouldRestoreBrowseFocusAfterDetailClose(DISCOVERY_ZONE_ORIGIN), false);
  assert.equal(shouldRestoreBrowseFocusAfterDetailClose('browse'), true);
  assert.equal(shouldRestoreBrowseFocusAfterDetailClose('search'), false);
});
