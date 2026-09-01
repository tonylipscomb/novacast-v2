import { assert, assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1';
import { getPackages, getReseller, createM3uAccount, parseM3uUrl, GoldPanelError } from './goldPanelClient.ts';
import { redactGoldSecrets } from './goldPanelSanitization.ts';

async function withGoldResponse(payload: unknown, callback: (getUrl: () => URL) => Promise<void>, status = 200, action = 'bouquet') {
  const previousDeno = globalThis.Deno;
  const previousFetch = globalThis.fetch;
  let requestedUrl: URL | null = null;
  Object.defineProperty(globalThis, 'Deno', {
    configurable: true,
    value: { env: { get: (name: string) => name === 'GOLD_PANEL_API_KEY' ? 'test-api-key' : undefined } },
  });
  globalThis.fetch = async (input) => {
    requestedUrl = new URL(String(input));
    assertEquals(requestedUrl.searchParams.get('action'), action);
    assertEquals(requestedUrl.searchParams.get('api_key'), 'test-api-key');
    return new Response(JSON.stringify(payload), { status });
  };
  try {
    await callback(() => {
      if (!requestedUrl) throw new Error('Gold request was not made');
      return requestedUrl;
    });
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
    assertEquals(await getPackages(), { packages: [
      { id: '132', name: 'SMALL - ARABIC' },
      { id: '152', name: 'Canada without adult' },
    ] });
  });
});

Deno.test('normalizes numeric bouquet ids', async () => {
  await withGoldResponse([{ id: 132, name: 'Package' }], async () => {
    assertEquals(await getPackages(), { packages: [{ id: '132', name: 'Package' }] });
  });
});

Deno.test('accepts an empty bouquet response', async () => {
  await withGoldResponse([], async () => {
    assertEquals(await getPackages(), { packages: [] });
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

Deno.test('surfaces safe Gold result errors', async () => {
  await withGoldResponse({ status: 'error', result: 'Something is missing' }, async () => {
    await assertRejects(
      () => createM3uAccount({ sub: '99', pack: 'all', country: 'US' }),
      (error) => error instanceof GoldPanelError && error.message === 'Something is missing',
    );
  }, 200, 'new');
});

Deno.test('redacts credential-bearing Gold result errors', async () => {
  await withGoldResponse({ status: 'error', result: 'api_key=test-api-key password=secret http://gold.example/get.php?username=u&password=p' }, async () => {
    await assertRejects(
      () => getPackages(),
      (error) => error instanceof GoldPanelError && !error.message.includes('test-api-key') && !error.message.includes('password=secret') && !error.message.includes('get.php?'),
    );
  });
});

Deno.test('preserves message, error, and msg Gold error extraction', async () => {
  for (const key of ['message', 'error', 'msg']) {
    await withGoldResponse({ status: 'false', [key]: `failure from ${key}` }, async () => {
      await assertRejects(
        () => getReseller(),
        (error) => error instanceof GoldPanelError && error.message === `failure from ${key}`,
      );
    }, 200, 'reseller');
  }
});

Deno.test('uses the generic fallback for non-string Gold result errors', async () => {
  await withGoldResponse({ status: 'error', result: { reason: 'internal' } }, async () => {
    await assertRejects(
      () => createM3uAccount({ sub: '99', pack: 'all', country: 'US' }),
      (error) => error instanceof GoldPanelError && error.message === 'Gold Panel request failed',
    );
  }, 200, 'new');
});

Deno.test('accepts bouquet packages without a status field', async () => {
  await withGoldResponse([{ id: '1', name: 'No status package' }], async () => {
    assertEquals(await getPackages(), { packages: [{ id: '1', name: 'No status package' }] });
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

Deno.test('sends the explicit demo request with all bouquets', async () => {
  await withGoldResponse(
    { status: 'true', url: 'https://gold.example/get.php?username=demo&password=secret' },
    async (getUrl) => {
      await createM3uAccount({ sub: '99', pack: 'all', country: 'US' });
      const url = getUrl();
      assertEquals(url.searchParams.get('type'), 'm3u');
      assertEquals(url.searchParams.get('sub'), '99');
      assertEquals(url.searchParams.get('pack'), 'all');
    },
    200,
    'new',
  );
});

Deno.test('preserves paid subscription code instead of treating sub=1 as a demo', async () => {
  await withGoldResponse(
    { status: 'true', url: 'https://gold.example/get.php?username=paid&password=secret' },
    async (getUrl) => {
      await createM3uAccount({ sub: '1', pack: '132', country: 'US' });
      const url = getUrl();
      assertEquals(url.searchParams.get('sub'), '1');
      assertEquals(url.searchParams.get('pack'), '132');
    },
    200,
    'new',
  );
});
