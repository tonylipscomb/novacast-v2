import { assert, assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1';
import { getPackages, getReseller, createM3uAccount, parseM3uUrl, GoldPanelError } from './goldPanelClient.ts';
import { redactGoldSecrets } from './goldPanelSanitization.ts';

async function withGoldResponse(payload: unknown, callback: () => Promise<void>, status = 200, action = 'bouquet') {
  const previousDeno = globalThis.Deno;
  const previousFetch = globalThis.fetch;
  Object.defineProperty(globalThis, 'Deno', {
    configurable: true,
    value: { env: { get: (name: string) => name === 'GOLD_PANEL_API_KEY' ? 'test-api-key' : undefined } },
  });
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assertEquals(url.searchParams.get('action'), action);
    assertEquals(url.searchParams.get('api_key'), 'test-api-key');
    return new Response(JSON.stringify(payload), { status });
  };
  try {
    await callback();
  } finally {
    Object.defineProperty(globalThis, 'Deno', { configurable: true, value: previousDeno });
    globalThis.fetch = previousFetch;
  }
}

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

Deno.test('normalizes the documented bouquet response', async () => {
  await withGoldResponse([
    { id: '132', name: 'SMALL - ARABIC' },
    { id: '152', name: 'Canada without adult' },
  ], async () => {
    assertEquals(await getPackages(), [
      { id: '132', name: 'SMALL - ARABIC' },
      { id: '152', name: 'Canada without adult' },
    ]);
  });
});

Deno.test('normalizes numeric bouquet ids', async () => {
  await withGoldResponse([{ id: 132, name: 'Package' }], async () => {
    assertEquals(await getPackages(), [{ id: '132', name: 'Package' }]);
  });
});

Deno.test('accepts an empty bouquet response', async () => {
  await withGoldResponse([], async () => {
    assertEquals(await getPackages(), []);
  });
});

Deno.test('rejects malformed non-array bouquet responses safely', async () => {
  await withGoldResponse({ packages: 'not-an-array' }, async () => {
    await assertRejects(
      () => getPackages(),
      GoldPanelError,
      'gold_packages_invalid_response',
    );
  });
});

Deno.test('sanitizes Gold bouquet error objects', async () => {
  await withGoldResponse({ status: 'false', message: 'Invalid api_key=test-api-key password=secret' }, async () => {
    try {
      await getPackages();
      throw new Error('expected Gold error');
    } catch (error) {
      assert(error instanceof GoldPanelError);
      assertEquals(error.category, 'gold_operation_failed');
      assert(!error.message.includes('test-api-key'));
      assert(!error.message.includes('password=secret'));
    }
  });
});

Deno.test('accepts bouquet packages without a status field', async () => {
  await withGoldResponse([{ id: '1', name: 'No status package' }], async () => {
    assertEquals(await getPackages(), [{ id: '1', name: 'No status package' }]);
  });
});

Deno.test('retains status validation for reseller responses', async () => {
  const previousDeno = globalThis.Deno;
  const previousFetch = globalThis.fetch;
  Object.defineProperty(globalThis, 'Deno', { configurable: true, value: { env: { get: (name: string) => name === 'GOLD_PANEL_API_KEY' ? 'test-api-key' : undefined } } });
  globalThis.fetch = async () => new Response(JSON.stringify({ status: 'false', message: 'disabled' }));
  try {
    await assertRejects(() => getReseller(), GoldPanelError, 'gold_operation_failed');
  } finally {
    Object.defineProperty(globalThis, 'Deno', { configurable: true, value: previousDeno });
    globalThis.fetch = previousFetch;
  }
});

Deno.test('retains reseller normalization', async () => {
  await withGoldResponse(
    { status: 'true', username: 'reseller', credits: '12', enabled: 'true' },
    async () => {
      assertEquals(await getReseller(), { username: 'reseller', credits: 12, enabled: true });
    },
    200,
    'reseller',
  );
});

Deno.test('retains status validation for create-account responses', async () => {
  const previousDeno = globalThis.Deno;
  const previousFetch = globalThis.fetch;
  Object.defineProperty(globalThis, 'Deno', { configurable: true, value: { env: { get: (name: string) => name === 'GOLD_PANEL_API_KEY' ? 'test-api-key' : undefined } } });
  globalThis.fetch = async () => new Response(JSON.stringify({ status: 'false', message: 'disabled' }));
  try {
    await assertRejects(() => createM3uAccount({ sub: '1', pack: '2', country: 'ALL' }), GoldPanelError, 'gold_operation_failed');
  } finally {
    Object.defineProperty(globalThis, 'Deno', { configurable: true, value: previousDeno });
    globalThis.fetch = previousFetch;
  }
});

Deno.test('retains create-account M3U normalization', async () => {
  await withGoldResponse(
    { status: 'true', url: 'https://gold.example:8443/get.php?password=p%26x&username=user%40x&output=ts' },
    async () => {
      assertEquals(await createM3uAccount({ sub: '1', pack: '2', country: 'ALL' }), {
        type: 'xtream',
        baseUrl: 'https://gold.example:8443',
        username: 'user@x',
        password: 'p&x',
        upstreamUrl: 'https://gold.example:8443/get.php?password=p%26x&username=user%40x&output=ts',
        output: 'ts',
      });
    },
    200,
    'new',
  );
});
