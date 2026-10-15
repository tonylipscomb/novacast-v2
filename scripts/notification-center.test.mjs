import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dismissCenterNotification,
  getNotificationCenterSnapshot,
  markAllNotificationsRead,
  markNotificationRead,
  recordNotification,
  resetNotificationCenterForTests,
} from '../src/features/notifications/notificationCenterStore.ts';

test.beforeEach(() => resetNotificationCenterForTests());

test('notification center keeps stable IDs and read state', () => {
  recordNotification({ id: 'update', category: 'app-update', type: 'info', title: 'Update available', actionLabel: 'View update' });
  assert.equal(getNotificationCenterSnapshot()[0].readAt, null);
  markNotificationRead('update');
  assert.ok(getNotificationCenterSnapshot()[0].readAt);
  recordNotification({ id: 'update', category: 'app-update', type: 'info', title: 'Update available', actionLabel: 'View update' });
  assert.equal(getNotificationCenterSnapshot().length, 1);
});

test('mark all read and dismiss preserve the record without resurfacing it', () => {
  recordNotification({ id: 'a', category: 'general', type: 'info', title: 'A' });
  recordNotification({ id: 'b', category: 'maintenance', type: 'warning', title: 'B' });
  markAllNotificationsRead();
  assert.ok(getNotificationCenterSnapshot().every((entry) => entry.readAt !== null));
  dismissCenterNotification('a');
  assert.ok(getNotificationCenterSnapshot().find((entry) => entry.id === 'a')?.dismissedAt);
});
