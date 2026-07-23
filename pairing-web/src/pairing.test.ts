import assert from 'node:assert/strict';
import test from 'node:test';
import { failureMessage, normalizeCode, normalizeProviderUrl } from './pairing.ts';

test('pairing form normalizes the TV code', () => {
  assert.equal(normalizeCode('ab-cd 1234'), 'ABCD1234');
});

test('pairing form accepts plain http provider URLs', () => {
  assert.equal(normalizeProviderUrl('http://max8k.top/'), 'http://max8k.top');
});

test('pairing form rejects non-URL server values', () => {
  assert.throws(() => normalizeProviderUrl('091d0febec'), /invalid_provider_url/);
});

test('pairing form maps http rejection failures', () => {
  assert.match(failureMessage('http_provider_not_allowed'), /HTTP/i);
});

test('pairing form maps invalid provider URL failures', () => {
  assert.match(failureMessage('invalid_provider_url'), /valid provider server URL/i);
});

test('pairing form uses sanitized failure messages', () => {
  assert.match(failureMessage('authentication_failed'), /credentials/);
  assert.match(failureMessage('password=secret'), /temporarily unavailable/);
});
