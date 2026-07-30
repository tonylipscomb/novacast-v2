import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getFocusLatencySnapshotForTests,
  initializeFocusLatencyAudit,
  noteFocusLatencyFocus,
  noteFocusLatencyKeyEvent,
  setFocusLatencyPhase,
} from '../src/features/diagnostics/focusLatencyAudit.ts';

test('focus latency pairs key event with matching focus', () => {
  process.env.EXPO_PUBLIC_NOVACAST_CATALOG_AUDIT = '1';
  initializeFocusLatencyAudit();
  setFocusLatencyPhase('unit');

  noteFocusLatencyKeyEvent('up');
  noteFocusLatencyFocus('nav:movies');

  const snapshot = getFocusLatencySnapshotForTests();
  assert.ok(snapshot.samples.some((sample) => sample.kind === 'navbar'));
  assert.equal(snapshot.pending, null);
});

test('superseded keys are counted when another key arrives first', () => {
  process.env.EXPO_PUBLIC_NOVACAST_CATALOG_AUDIT = '1';
  initializeFocusLatencyAudit();
  setFocusLatencyPhase('unit-super');

  noteFocusLatencyKeyEvent('left');
  noteFocusLatencyKeyEvent('right');
  noteFocusLatencyFocus('nav:series');

  const snapshot = getFocusLatencySnapshotForTests();
  assert.ok(snapshot.superseded >= 1);
  assert.ok(snapshot.unmatchedKeys >= 1);
});
