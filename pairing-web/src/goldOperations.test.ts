import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyGoldExpiration } from './goldOperations.ts';

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
