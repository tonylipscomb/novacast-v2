import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDiagnosticValue, normalizeDiagnosticLogs } from './diagnosticsNormalization.ts';

test('diagnostic normalization handles null and malformed payloads', () => {
    assert.deepEqual(normalizeDiagnosticLogs(null), []);
    assert.deepEqual(normalizeDiagnosticLogs(undefined), []);
    assert.deepEqual(normalizeDiagnosticLogs([null, 'bad', { logged_at: 'not a date', level: 'wat', context: [] }]), [
      { id: undefined, logged_at: null, level: 'info', category: 'app', message: 'Diagnostic event', context: {} },
    ]);
});

test('diagnostic normalization preserves valid support log facts', () => {
    assert.deepEqual(normalizeDiagnosticLogs([{ id: '1', logged_at: '2026-08-27T12:00:00Z', level: 'error', category: 'playback', message: 'Failed', context: { contentTitle: 'Demo' } }]), [
      { id: '1', logged_at: '2026-08-27T12:00:00Z', level: 'error', category: 'playback', message: 'Failed', context: { contentTitle: 'Demo' } },
    ]);
});

test('nested streamHost context is always representable as text', () => {
  for (const streamHost of [null, ['a', 'b'], { nested: { value: true } }, { hostname: 'example.test' }]) {
    const [entry] = normalizeDiagnosticLogs([{ timestamp: 'ignored', logged_at: '2026-08-27T12:00:00Z', level: 'info', message: 'test', context: { streamHost } }]);
    assert.equal(typeof formatDiagnosticValue(entry.context.streamHost), 'string');
  }
});
