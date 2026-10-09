import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./AdminDevices.tsx', import.meta.url), 'utf8');

test('production device page uses lifecycle and provider language', () => {
  assert.match(source, />All devices</u);
  assert.match(source, />Suspended</u);
  assert.match(source, />Blocked</u);
  assert.match(source, />Provider status</u);
  assert.match(source, />Assignment:/u);
  assert.doesNotMatch(source, /ACTIVE \(BETA\)|All beta statuses|All beta devices|BETA ACCESS|Extend device access|Never expires/u);
});

test('routine beta extension controls are absent while provider and revoke actions remain', () => {
  assert.doesNotMatch(source, /onExtend|saveExtension|Extend access|Save extension|Never expires/u);
  assert.match(source, /Change provider for/);
  assert.match(source, /Revoke/);
});
