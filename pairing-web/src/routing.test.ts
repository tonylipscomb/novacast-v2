import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyLegacyPairingRedirect,
  legacyPairingRedirectTarget,
  resolveAppRoute,
} from './routing.ts';

test('resolves connect site routes', () => {
  assert.equal(resolveAppRoute('/'), 'home');
  assert.equal(resolveAppRoute('/download'), 'download');
  assert.equal(resolveAppRoute('/pair'), 'pair');
  assert.equal(resolveAppRoute('/activate'), 'activate');
  assert.equal(resolveAppRoute('/admin'), 'admin');
  assert.equal(resolveAppRoute('/admin/devices'), 'admin');
});

test('legacy root pairing codes redirect to /pair', () => {
  assert.equal(
    legacyPairingRedirectTarget('/', '?code=ab-cd1234'),
    '/pair?code=ABCD1234'
  );
  assert.equal(legacyPairingRedirectTarget('/pair', '?code=ABCD1234'), null);
  assert.equal(legacyPairingRedirectTarget('/', ''), null);
});

test('legacy redirect helper invokes assign exactly once', () => {
  const assigned: string[] = [];
  const redirected = applyLegacyPairingRedirect(
    { pathname: '/', search: '?code=ABCDEFGH' },
    (url) => assigned.push(url)
  );
  assert.equal(redirected, true);
  assert.deepEqual(assigned, ['/pair?code=ABCDEFGH']);
});
