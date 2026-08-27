import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureRemainingLabel, deviceMatchesQuery } from './deviceDiagnosticsPresentation.ts';

const device = { publicDeviceCode: 'NC-1234-ABCD', assignedTesterName: 'Tony', assignedTesterEmail: 'tony@example.com', friendlyName: 'Living Room', manufacturer: 'onn.', model: '4K Plus' };
test('device search matches public code, tester, email, and model', () => {
  assert.equal(deviceMatchesQuery(device, 'NC-1234'), true);
  assert.equal(deviceMatchesQuery(device, 'TONY'), true);
  assert.equal(deviceMatchesQuery(device, 'example.com'), true);
  assert.equal(deviceMatchesQuery(device, '4k plus'), true);
  assert.equal(deviceMatchesQuery(device, 'missing'), false);
});
test('capture countdown is derived from the backend expiry', () => {
  assert.equal(captureRemainingLabel('2026-01-01T00:15:00.000Z', Date.parse('2026-01-01T00:00:00.000Z')), '15m 0s');
});
