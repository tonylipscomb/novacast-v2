import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeLiveStartupKey,
  shouldRestartLiveStartup,
} from '../src/features/live/liveTvStartupGate.ts';

test('same provider + generation does not restart startup pipeline', () => {
  const key = computeLiveStartupKey('xtream-1', 1);
  assert.equal(shouldRestartLiveStartup(key, computeLiveStartupKey('xtream-1', 1)), false);
});

test('persisted initial-category change alone does not affect the startup key', () => {
  // The startup key intentionally ignores category so persisting the selected
  // category after the first load cannot re-run the full pipeline.
  const first = computeLiveStartupKey('xtream-1', 1);
  const second = computeLiveStartupKey('xtream-1', 1);
  assert.equal(first, second);
  assert.equal(shouldRestartLiveStartup(first, second), false);
});

test('provider change restarts the startup pipeline', () => {
  const previous = computeLiveStartupKey('xtream-1', 1);
  assert.equal(shouldRestartLiveStartup(previous, computeLiveStartupKey('xtream-2', 1)), true);
});

test('published generation change restarts the startup pipeline', () => {
  const previous = computeLiveStartupKey('xtream-1', 1);
  assert.equal(shouldRestartLiveStartup(previous, computeLiveStartupKey('xtream-1', 2)), true);
});

test('first run (no previous key) restarts the startup pipeline', () => {
  assert.equal(shouldRestartLiveStartup(null, computeLiveStartupKey('xtream-1', 1)), true);
});

test('undefined provider/generation is a stable key', () => {
  const a = computeLiveStartupKey(undefined, undefined);
  const b = computeLiveStartupKey(null, 0);
  assert.equal(a, b);
  assert.equal(shouldRestartLiveStartup(a, b), false);
});
