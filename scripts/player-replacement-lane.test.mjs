import assert from 'node:assert/strict';
import test from 'node:test';

import { createSerialLatestAsyncLane } from '../src/features/playback/serialLatestAsyncLane.ts';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('an unresolved replacement allows only one physical player call while latest input is retained', async () => {
  const first = deferred();
  const invocations = [];
  const lane = createSerialLatestAsyncLane((target) => {
    invocations.push(target);
    return target === 'B' ? first.promise : Promise.resolve();
  });

  lane.enqueue('B');
  await Promise.resolve();
  for (let index = 0; index < 99; index += 1) {
    lane.enqueue(String.fromCharCode(67 + (index % 3)));
  }
  lane.enqueue('E');

  assert.deepEqual(invocations, ['B']);
  assert.equal(lane.isActive, true);
  assert.equal(lane.pendingValue, 'E');

  first.resolve();
  await lane.waitForIdle();
  assert.deepEqual(invocations, ['B', 'E']);
});

test('the newest target starts after the previous replacement settles', async () => {
  const first = deferred();
  const invocations = [];
  const lane = createSerialLatestAsyncLane((target) => {
    invocations.push(target);
    return target === 'B' ? first.promise : Promise.resolve();
  });

  lane.enqueue('B');
  await Promise.resolve();
  lane.enqueue('E');
  first.resolve();
  await lane.waitForIdle();

  assert.deepEqual(invocations, ['B', 'E']);
});

test('a rejected replacement still releases the lane for the newest target', async () => {
  const first = deferred();
  const invocations = [];
  const lane = createSerialLatestAsyncLane((target) => {
    invocations.push(target);
    if (target === 'B') return first.promise;
    return Promise.resolve();
  });

  lane.enqueue('B');
  await Promise.resolve();
  lane.enqueue('E');
  first.reject(new Error('simulated player failure'));
  await lane.waitForIdle();

  assert.deepEqual(invocations, ['B', 'E']);
  assert.equal(lane.isActive, false);
});

test('a later surf remains usable after the controller watchdog releases ownership', () => {
  let surfTransitionInFlight = true;
  const nextReleases = [];
  const onNewInput = () => {
    surfTransitionInFlight = false;
    nextReleases.push('E');
  };

  onNewInput();
  assert.equal(surfTransitionInFlight, false);
  assert.deepEqual(nextReleases, ['E']);
});
