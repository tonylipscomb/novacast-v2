import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyGoldExpiration, filterGoldLines, GOLD_CAPABILITIES, normalizeGoldLine } from './goldOperations.ts';

const now = new Date(2026, 8, 4, 12, 0, 0);
const date = (day: number) => new Date(2026, 8, day, 23, 59, 0).toISOString();

test('classifies expiration buckets using calendar boundaries', () => {
  assert.equal(classifyGoldExpiration(new Date(2026, 8, 4, 11, 59).toISOString(), now), 'expired');
  assert.equal(classifyGoldExpiration(date(4), now), 'today');
  assert.equal(classifyGoldExpiration('2026-09-04', now), 'today');
  assert.equal(classifyGoldExpiration(date(5), now), 'tomorrow');
  assert.equal(classifyGoldExpiration(date(10), now), 'next7');
  assert.equal(classifyGoldExpiration(date(20), now), 'next30');
  assert.equal(classifyGoldExpiration(date(40), now), 'later');
});

test('invalid and missing expiration are unknown', () => {
  assert.equal(classifyGoldExpiration(undefined, now), 'unknown');
  assert.equal(classifyGoldExpiration('', now), 'unknown');
  assert.equal(classifyGoldExpiration('not-a-date', now), 'unknown');
});

test('boundaries are mutually exclusive and disabled status does not affect classification', () => {
  assert.equal(classifyGoldExpiration(new Date(2026, 8, 11, 0, 0).toISOString(), now), 'next7');
  assert.equal(classifyGoldExpiration(new Date(2026, 8, 12, 0, 0).toISOString(), now), 'next30');
  assert.equal(classifyGoldExpiration(date(4), now), 'today');
});

test('Gold line normalization preserves only sanitized operational fields', () => {
  const line = normalizeGoldLine({
    id: 'account-1', gold_user_id: 'gold-user', gold_package_name: 'Sports', gold_country: 'US',
    gold_expiration: '2026-09-10', gold_enabled: true, credentials_ciphertext: 'must-not-display',
    provider: { display_name: 'Gold Demo', status: 'active', health_status: 'healthy' },
    assignedDevice: { public_device_code: 'NC-1234' },
  });
  assert.deepEqual({ id: line.id, providerId: line.providerId, username: line.username, displayName: line.displayName, packageName: line.packageName, assignedDevice: line.assignedDevice }, {
    id: 'account-1', providerId: '', username: 'gold-user', displayName: 'Gold Demo', packageName: 'Sports', assignedDevice: 'NC-1234',
  });
  assert.equal('credentials_ciphertext' in line, false);
});

test('Gold line filters support username and expiration status', () => {
  const lines = [
    normalizeGoldLine({ id: 'active', gold_user_id: 'Alpha', gold_expiration: '2099-01-01', gold_enabled: true }),
    normalizeGoldLine({ id: 'expired', gold_user_id: 'Beta', gold_expiration: '2020-01-01', gold_enabled: true }),
  ];
  assert.deepEqual(filterGoldLines(lines, 'alpha', 'active').map((line) => line.id), ['active']);
  assert.deepEqual(filterGoldLines(lines, '', 'expired').map((line) => line.id), ['expired']);
});

test('Gold capability map exposes only actions backed by the current API', () => {
  assert.equal(GOLD_CAPABILITIES.renewAccount, 'supported');
  assert.equal(GOLD_CAPABILITIES.setAccountStatus, 'supported');
  assert.equal(GOLD_CAPABILITIES.editLine, 'unsupported');
  assert.equal(GOLD_CAPABILITIES.refund, 'unsupported');
});
