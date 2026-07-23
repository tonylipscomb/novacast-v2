import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveSettingsActionNotification } from '../src/features/settings/settingsScreenLogic.ts';

test('Settings notifications only surface recoverable action failures', () => {
  assert.equal(resolveSettingsActionNotification(null, false), null);

  const smart = resolveSettingsActionNotification('smart-categories', false);
  assert.equal(smart?.title, 'Settings not saved');
  assert.match(smart?.message ?? '', /Smart Categories/i);
  assert.equal(smart?.persistent, false);

  const replay = resolveSettingsActionNotification('replay-guides', true);
  assert.equal(replay?.title, 'Guides not reset');
  assert.equal(replay?.persistent, true);

  const suppress = resolveSettingsActionNotification('suppress-guides', false);
  assert.equal(suppress?.title, 'Guides not updated');
  assert.match(suppress?.message ?? '', /Guide preferences/i);
});
