import { assert, assertEquals, assertMatch, assertRejects } from 'jsr:@std/assert@1';
import { createPairingCode, normalizeCode, normalizeProviderUrl } from './security.ts';

Deno.test('pairing code excludes ambiguous characters and has fixed length', () => {
  const code = createPairingCode();
  assertEquals(code.length, 8);
  assertMatch(code, /^[A-HJ-NP-Z2-9]{8}$/);
  assert(!/[01IO]/.test(code));
});

Deno.test('pairing code lookup is case and separator insensitive', () => {
  assertEquals(normalizeCode('ab-cd 1234'), 'ABCD1234');
});

Deno.test('http provider URLs are allowed by default', async () => {
  const original = Deno.env.get('ALLOW_HTTP_PROVIDER');
  try {
    Deno.env.delete('ALLOW_HTTP_PROVIDER');
    assertEquals(await normalizeProviderUrl('http://max8k.top/'), 'http://max8k.top');
  } finally {
    if (original === undefined) Deno.env.delete('ALLOW_HTTP_PROVIDER');
    else Deno.env.set('ALLOW_HTTP_PROVIDER', original);
  }
});

Deno.test('http provider URLs can be disabled explicitly', async () => {
  const original = Deno.env.get('ALLOW_HTTP_PROVIDER');
  try {
    Deno.env.set('ALLOW_HTTP_PROVIDER', 'false');
    await assertRejects(() => normalizeProviderUrl('http://max8k.top/'), Error, 'http_provider_not_allowed');
  } finally {
    if (original === undefined) Deno.env.delete('ALLOW_HTTP_PROVIDER');
    else Deno.env.set('ALLOW_HTTP_PROVIDER', original);
  }
});
