import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveSettingsActionNotification } from '../src/features/settings/settingsScreenLogic.ts';

test('Settings notifications only surface recoverable action failures', () => {
  assert.equal(resolveSettingsActionNotification(null, false), null);

  const smart = resolveSettingsActionNotification('smart-categories', false);
  assert.equal(smart?.title, 'Setting could not be updated');
  assert.equal(smart?.message, 'Please try the setting again.');
  assert.equal(smart?.persistent, false);

  const replay = resolveSettingsActionNotification('replay-guides', true);
  assert.equal(replay?.title, 'Setting could not be updated');
  assert.equal(replay?.persistent, true);

  const suppress = resolveSettingsActionNotification('suppress-guides', false);
  assert.equal(suppress?.title, 'Setting could not be updated');
  assert.equal(suppress?.message, 'Please try the setting again.');
});
