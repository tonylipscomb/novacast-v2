import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveNotificationInitialFocusTarget,
  shouldCaptureNotificationFocus,
  isPassiveNotification,
  resolveNotificationInteractionMode,
} from '../src/features/notifications/notificationFocusLogic.ts';
import {
  getNotificationsSnapshot,
  resetNotificationsForTests,
  showNotification,
} from '../src/features/notifications/notificationStore.ts';

test('notification focus defaults to Dismiss unless autoFocusAction requests Retry', () => {
  assert.equal(resolveNotificationInitialFocusTarget(false, true), 'dismiss');
  assert.equal(resolveNotificationInitialFocusTarget(false, false), 'dismiss');
  assert.equal(resolveNotificationInitialFocusTarget(true, true), 'action');
  assert.equal(resolveNotificationInitialFocusTarget(true, false), 'dismiss');
});

test('only a topmost blocking toast may capture TV focus', () => {
  assert.equal(shouldCaptureNotificationFocus(true, 'blocking'), true);
  assert.equal(shouldCaptureNotificationFocus(false, 'blocking'), false);
  assert.equal(shouldCaptureNotificationFocus(true, 'passive'), false);
  assert.equal(shouldCaptureNotificationFocus(true, undefined), false);
});

test('notifications default to passive interaction mode', () => {
  resetNotificationsForTests();
  showNotification({ id: 'passive-default', type: 'info', title: 'Hello' });
  const [notification] = getNotificationsSnapshot().visible;
  assert.equal(resolveNotificationInteractionMode(notification.interactionMode), 'passive');
  assert.equal(isPassiveNotification(notification.interactionMode), true);
});
