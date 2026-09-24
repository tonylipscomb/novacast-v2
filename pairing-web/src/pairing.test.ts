import assert from 'node:assert/strict';
import test from 'node:test';
import { failureMessage, normalizeCode, normalizeProviderUrl } from './pairing.ts';

test('pairing form normalizes the TV code', () => {
  assert.equal(normalizeCode('ab-cd 1234'), 'ABCD1234');
});

test('pairing form accepts plain http provider URLs', () => {
  assert.equal(normalizeProviderUrl('http://max8k.top/'), 'http://max8k.top');
  assert.equal(normalizeProviderUrl('http://max8k.top/player_api.php'), 'http://max8k.top');
});

test('pairing form rejects localhost provider URLs', () => {
  assert.throws(() => normalizeProviderUrl('http://localhost'), /unsafe_provider_target/);
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

test('adminRequest leaves FormData content type for the browser boundary', async () => {
  const originalFetch = globalThis.fetch;
  let captured: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    captured = init;
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const { adminRequest } = await import('./pairing.ts');
    const form = new FormData();
    form.append('file', new File(['x'], 'x.png', { type: 'image/png' }));
    await adminRequest('admin-novapulse-announcements?action=upload_artwork', 'token', { method: 'POST', body: form });
    assert.equal(new Headers(captured?.headers).get('Content-Type'), null);
    assert.equal(new Headers(captured?.headers).get('Authorization'), 'Bearer token');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
