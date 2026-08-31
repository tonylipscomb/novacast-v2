import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@1';
import { parseM3uUrl, GoldPanelError } from './goldPanelClient.ts';
import { redactGoldSecrets } from './goldPanelSanitization.ts';

Deno.test('parses generated Xtream M3U URL without using get.php as base URL', () => {
  const result = parseM3uUrl('http://gold.example:8080/get.php?username=user%40x&password=p%26x&type=m3u_plus&output=ts');
  assertEquals(result.baseUrl, 'http://gold.example:8080');
  assertEquals(result.username, 'user@x');
  assertEquals(result.password, 'p&x');
  assertEquals(result.output, 'ts');
});

Deno.test('rejects malformed generated M3U URLs', () => {
  assertThrows(() => parseM3uUrl('not-a-url'), GoldPanelError, 'gold_m3u_invalid');
  assertThrows(() => parseM3uUrl('http://gold.example/get.php?username=user'), GoldPanelError, 'gold_m3u_invalid');
});

Deno.test('redacts Gold and credential-bearing values', () => {
  const value = redactGoldSecrets({ api_key: 'secret', url: 'http://x/get.php?username=u&password=p' }, ['p']);
  assert(JSON.stringify(value).includes('[redacted]'));
  assert(!JSON.stringify(value).includes('password=p'));
});
