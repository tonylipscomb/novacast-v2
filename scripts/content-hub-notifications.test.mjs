import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveContentHubProviderSwitchNotification } from '../src/features/hub/contentHubScreenLogic.ts';

test('Content Hub notifications only surface provider switch failures', () => {
  assert.equal(resolveContentHubProviderSwitchNotification(null, false), null);
  assert.equal(resolveContentHubProviderSwitchNotification('', false), null);
  assert.equal(resolveContentHubProviderSwitchNotification('   ', false), null);

  const error = resolveContentHubProviderSwitchNotification('Connection timed out', false);
  assert.equal(error?.title, 'Provider switch failed');
  assert.match(error?.message ?? '', /could not connect/i);
  assert.equal(error?.persistent, false);
  assert.equal(resolveContentHubProviderSwitchNotification('Connection timed out', true)?.persistent, true);
});
