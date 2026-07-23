import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveAuthInitNotification,
  resolveAuthPairingNotification,
} from '../src/features/startup/authScreenLogic.ts';

test('Auth init notifications only surface startup connection failures', () => {
  assert.equal(resolveAuthInitNotification(false, false), null);

  const init = resolveAuthInitNotification(true, false);
  assert.equal(init?.title, 'Provider connection failed');
  assert.match(init?.message ?? '', /could not connect/i);
  assert.equal(init?.persistent, false);
  assert.equal(resolveAuthInitNotification(true, true)?.persistent, true);
});

test('Auth pairing notifications only surface pairing connection failures', () => {
  assert.equal(resolveAuthPairingNotification(false, false), null);

  const pairing = resolveAuthPairingNotification(true, false);
  assert.equal(pairing?.title, 'Pairing connection failed');
  assert.match(pairing?.message ?? '', /could not connect/i);
  assert.equal(pairing?.persistent, false);
  assert.equal(resolveAuthPairingNotification(true, true)?.persistent, true);
});
