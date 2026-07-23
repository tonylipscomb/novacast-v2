import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveNotificationInitialFocusTarget,
  shouldCaptureNotificationFocus,
} from '../src/features/notifications/notificationFocusLogic.ts';

test('notification focus defaults to Dismiss unless autoFocusAction requests Retry', () => {
  assert.equal(resolveNotificationInitialFocusTarget(false, true), 'dismiss');
  assert.equal(resolveNotificationInitialFocusTarget(false, false), 'dismiss');
  assert.equal(resolveNotificationInitialFocusTarget(true, true), 'action');
  assert.equal(resolveNotificationInitialFocusTarget(true, false), 'dismiss');
});

test('only the topmost visible toast should capture TV focus', () => {
  assert.equal(shouldCaptureNotificationFocus(true), true);
  assert.equal(shouldCaptureNotificationFocus(false), false);
});
