import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clampUnifiedSeekTarget,
  msToSeconds,
  resolveUnifiedSeekPosition,
  shouldHandleUnifiedSeekRemoteEvent,
} from '../src/features/playback/unified/unifiedPlayerLogic.ts';

test('milliseconds convert to native seconds exactly once', () => {
  assert.equal(msToSeconds(90_000), 90);
});

test('seek clamps at zero and duration', () => {
  assert.equal(clampUnifiedSeekTarget(-5_000, 120_000), 0);
  assert.equal(clampUnifiedSeekTarget(130_000, 120_000), 120_000);
});

test('relative rewind and forward clamp correctly', () => {
  assert.equal(resolveUnifiedSeekPosition(5_000, 120_000, -10_000), 0);
  assert.equal(resolveUnifiedSeekPosition(115_000, 120_000, 30_000), 120_000);
});

test('TV seek events only apply while seek control owns focus', () => {
  assert.equal(
    shouldHandleUnifiedSeekRemoteEvent({
      visible: true,
      focusedControl: 'seek',
      durationMs: 120_000,
      eventType: 'right',
      eventKeyAction: 0,
    }),
    true,
  );

  assert.equal(
    shouldHandleUnifiedSeekRemoteEvent({
      visible: true,
      focusedControl: 'play',
      durationMs: 120_000,
      eventType: 'right',
      eventKeyAction: 0,
    }),
    false,
  );
});
