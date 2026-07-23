import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearScope,
  dismissNotification,
  getActiveNotificationTimerCountForTests,
  getNotificationsSnapshot,
  resetNotificationsForTests,
  showNotification,
  triggerNotificationAction,
} from '../src/features/notifications/notificationStore.ts';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function allIds() {
  const snapshot = getNotificationsSnapshot();
  return [...snapshot.visible, ...snapshot.queued].map((notification) => notification.id);
}

test.beforeEach(() => {
  resetNotificationsForTests();
});

test('showing a notification adds it to visible state', () => {
  const id = showNotification({ type: 'info', title: 'Hello there' });

  const snapshot = getNotificationsSnapshot();
  assert.equal(snapshot.visible.length, 1);
  assert.equal(snapshot.visible[0].id, id);
  assert.equal(snapshot.visible[0].title, 'Hello there');
});

test('showNotification defaults position to bottom-right and autoFocusAction to false', () => {
  showNotification({ id: 'defaults-1', type: 'success', title: 'Saved' });

  const [notification] = getNotificationsSnapshot().visible;
  assert.equal(notification.position, 'bottom-right');
  assert.equal(notification.autoFocusAction, false);
});

test('temporary notifications auto-dismiss after their duration', async () => {
  showNotification({ id: 'temp-1', type: 'info', title: 'Temporary', duration: 30 });
  assert.equal(getNotificationsSnapshot().visible.length, 1);

  await sleep(90);

  assert.equal(getNotificationsSnapshot().visible.length, 0);
});

test('persistent notifications remain until manually dismissed', async () => {
  showNotification({ id: 'persist-1', type: 'warning', title: 'Persistent', persistent: true, duration: 20 });

  await sleep(90);
  assert.equal(getNotificationsSnapshot().visible.length, 1);

  dismissNotification('persist-1');
  assert.equal(getNotificationsSnapshot().visible.length, 0);
});

test('an action callback fires exactly once even if triggered twice in a row', () => {
  let calls = 0;
  showNotification({
    id: 'action-1',
    type: 'error',
    title: 'Retry me',
    actionLabel: 'Retry',
    onAction: () => {
      calls += 1;
    },
  });

  triggerNotificationAction('action-1');
  triggerNotificationAction('action-1');

  assert.equal(calls, 1);
  assert.equal(getNotificationsSnapshot().visible.length, 0);
});

test('duplicate dedupeKey within the dedupe window refreshes instead of adding a second entry', () => {
  showNotification({ type: 'error', title: 'Guide data unavailable', message: 'First failure', dedupeKey: 'guide-error' });
  showNotification({ type: 'error', title: 'Guide data unavailable', message: 'Second failure', dedupeKey: 'guide-error' });

  const snapshot = getNotificationsSnapshot();
  assert.equal(snapshot.visible.length + snapshot.queued.length, 1);
  assert.equal(snapshot.visible[0].message, 'Second failure');
});

test('a maximum of 2 notifications are visible at once; a 3rd queues instead of stacking', () => {
  showNotification({ id: 'n1', type: 'info', title: 'One' });
  showNotification({ id: 'n2', type: 'info', title: 'Two' });
  showNotification({ id: 'n3', type: 'info', title: 'Three' });

  const snapshot = getNotificationsSnapshot();
  assert.equal(snapshot.visible.length, 2);
  assert.deepEqual(snapshot.visible.map((notification) => notification.id), ['n1', 'n2']);
  assert.deepEqual(snapshot.queued.map((notification) => notification.id), ['n3']);
});

test('dismissing a visible notification promotes the next queued notification', () => {
  showNotification({ id: 'p1', type: 'info', title: 'One' });
  showNotification({ id: 'p2', type: 'info', title: 'Two' });
  showNotification({ id: 'p3', type: 'info', title: 'Three' });

  dismissNotification('p1');

  const snapshot = getNotificationsSnapshot();
  assert.deepEqual(snapshot.visible.map((notification) => notification.id), ['p2', 'p3']);
  assert.equal(snapshot.queued.length, 0);
});

test('timers are cleaned up on dismiss with no leaks', () => {
  showNotification({ id: 'leak-1', type: 'info', title: 'Leak check', duration: 5000 });
  assert.equal(getActiveNotificationTimerCountForTests(), 1);

  dismissNotification('leak-1');
  assert.equal(getActiveNotificationTimerCountForTests(), 0);
});

test('clearScope removes only notifications tagged with that scope', () => {
  showNotification({ id: 'scope-guide', type: 'info', title: 'Guide notice', scope: 'guide' });
  showNotification({ id: 'scope-live', type: 'info', title: 'Live notice', scope: 'live' });
  showNotification({ id: 'scope-none', type: 'info', title: 'Unscoped notice' });

  clearScope('guide');

  assert.deepEqual(allIds().sort(), ['scope-live', 'scope-none']);
});

test('showing again with the same id updates the notification in place instead of duplicating', () => {
  showNotification({ id: 'dup-1', type: 'info', title: 'First', duration: 5000 });
  assert.equal(getActiveNotificationTimerCountForTests(), 1);

  showNotification({ id: 'dup-1', type: 'info', title: 'Second', duration: 5000 });

  const snapshot = getNotificationsSnapshot();
  assert.equal(snapshot.visible.length, 1);
  assert.equal(snapshot.visible[0].title, 'Second');
  assert.equal(getActiveNotificationTimerCountForTests(), 1);
});
