import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-ignore TS5097: Node's strip-types runner requires the explicit extension.
import {
  diagnosticEventLabel,
  diagnosticStatusLabel,
  diagnosticTone,
  formatDiagnosticDuration,
} from './diagnosticsPresentation.ts';

test('diagnostic event labels are human readable', () => {
  assert.equal(diagnosticEventLabel('play_attempt'), 'Trying to play');
  assert.equal(diagnosticEventLabel('network_request_failure'), 'Network request failed');
  assert.equal(diagnosticEventLabel('new_event_type'), 'new event type');
});

test('health tones and copy distinguish good, problem, and missing data', () => {
  assert.equal(diagnosticTone('HEALTHY'), 'good');
  assert.equal(diagnosticStatusLabel('OFFLINE'), 'PROBLEM');
  assert.equal(diagnosticStatusLabel(null), 'NOT ENOUGH DATA');
});

test('diagnostic durations use support-friendly units', () => {
  assert.equal(formatDiagnosticDuration(800), '800 ms');
  assert.equal(formatDiagnosticDuration(1600), '1.6 sec');
  assert.equal(formatDiagnosticDuration(undefined), 'Not enough data yet');
});
