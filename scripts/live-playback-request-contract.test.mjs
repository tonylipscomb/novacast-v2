import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLiveRequestContractVariants,
  classifyLiveRequestUserAgent,
  countLiveRequestHeaderMutations,
  describeExpectedLiveRequestContracts,
  describeSafeRangeHeader,
  isLiveRequestContractSuccess,
  LIVE_EXOPLAYER_USER_AGENT,
  LIVE_REQUEST_CONTRACT_CODEBASE_FINDINGS,
  LIVE_REQUEST_CONTRACT_DIAG,
  LIVE_VLC_USER_AGENT,
  listLiveRequestContractDifferences,
  logExpectedLiveRequestContractComparison,
  resetLivePlaybackRequestContractForTests,
  runLiveRequestContractAudit,
  scheduleLiveRequestContractAudit,
  selectProvenLiveRequestContractFix,
} from '../src/features/providers/livePlaybackRequestContract.ts';

const AUTH_URL = 'http://provider.example:8080/live/user/secret/201.ts';
const TS_BYTES = new Uint8Array([0x47, 0x40, 0x00, 0x10]);
const HTML_BODY = '<!doctype html><html><body>deny</body></html>';

function captureInfo(run) {
  const lines = [];
  const original = console.info;
  console.info = (...args) => {
    lines.push(args.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join(' '));
  };
  return Promise.resolve()
    .then(run)
    .finally(() => {
      console.info = original;
    })
    .then((result) => ({ result, lines }));
}

function assertNoSecrets(lines) {
  const haystack = lines.join('\n');
  assert.equal(haystack.includes('secret'), false);
  assert.equal(haystack.includes('/live/user/'), false);
  assert.equal(haystack.includes(AUTH_URL), false);
  assert.equal(haystack.includes('username'), false);
  assert.equal(haystack.includes('password'), false);
}

function jsonResponse(status, { contentType = 'video/mp2t', body = TS_BYTES, location = null, redirected = false } = {}) {
  const headers = new Headers();
  if (contentType) headers.set('content-type', contentType);
  if (location) headers.set('location', location);
  headers.set('server', 'nginx');
  return {
    status,
    redirected,
    headers,
    body: {
      getReader() {
        let done = false;
        return {
          async read() {
            if (done) return { done: true, value: undefined };
            done = true;
            return { done: false, value: body };
          },
          async cancel() {},
        };
      },
    },
  };
}

test.beforeEach(() => {
  resetLivePlaybackRequestContractForTests();
});

test('probe vs Media3 expected contracts differ on UA, Accept, Range, and keep-alive', () => {
  const expected = describeExpectedLiveRequestContracts();
  assert.equal(expected.probe.method, 'GET');
  assert.equal(expected.media3.method, 'GET');
  assert.equal(expected.probe.userAgentCategory, 'default');
  assert.equal(expected.media3.userAgentCategory, 'exoplayer');
  assert.equal(expected.probe.accept, null);
  assert.equal(expected.media3.accept, '*/*');
  assert.equal(expected.probe.rangePresent, false);
  assert.equal(expected.media3.rangePresent, true);
  assert.equal(expected.media3.rangeShape, 'bytes=0-');
  assert.equal(expected.probe.redirectFollow, true);
  assert.equal(expected.media3.redirectFollow, true);
  assert.deepEqual(listLiveRequestContractDifferences(), ['user-agent', 'accept', 'range', 'connection']);
});

test('variants change one request field at a time and never impersonate Smarters', () => {
  const variants = buildLiveRequestContractVariants();
  assert.deepEqual(
    variants.map((item) => item.id),
    ['baseline', 'ua-vlc', 'ua-exoplayer', 'accept-star', 'range-0-1023', 'connection-close', 'observe-redirect'],
  );
  for (const variant of variants) {
    const mutations = countLiveRequestHeaderMutations(variant.init);
    if (variant.id === 'baseline') {
      assert.equal(mutations, 0);
    } else {
      assert.equal(mutations, 1, variant.id);
    }
    const headers = new Headers(variant.init.headers);
    assert.equal(/smarters/i.test(headers.get('User-Agent') ?? ''), false);
  }
  assert.equal(LIVE_REQUEST_CONTRACT_CODEBASE_FINDINGS.smartersUserAgentPrecedent, false);
  assert.equal(LIVE_REQUEST_CONTRACT_CODEBASE_FINDINGS.outputQueryParamLiveBuilder, false);
  assert.equal(LIVE_REQUEST_CONTRACT_CODEBASE_FINDINGS.inAppProbeSendsCustomHeaders, false);
  assert.equal(LIVE_REQUEST_CONTRACT_CODEBASE_FINDINGS.media3CustomHeadersInApp, true);
  assert.equal(LIVE_REQUEST_CONTRACT_CODEBASE_FINDINGS.cloudHealthUsesExoPlayerUa, true);
});

test('User-Agent and Range classifiers stay credential-safe', () => {
  assert.deepEqual(classifyLiveRequestUserAgent(null), { category: 'default', hash: null });
  assert.equal(classifyLiveRequestUserAgent(LIVE_VLC_USER_AGENT).category, 'vlc');
  assert.equal(classifyLiveRequestUserAgent(LIVE_EXOPLAYER_USER_AGENT).category, 'exoplayer');
  assert.equal(classifyLiveRequestUserAgent('okhttp/4.12.0').category, 'okhttp');
  assert.equal(classifyLiveRequestUserAgent(LIVE_VLC_USER_AGENT).hash, classifyLiveRequestUserAgent(LIVE_VLC_USER_AGENT).hash);
  assert.deepEqual(describeSafeRangeHeader(null), { present: false, shape: null });
  assert.deepEqual(describeSafeRangeHeader('bytes=0-1023'), { present: true, shape: 'bytes=0-1023' });
  assert.deepEqual(describeSafeRangeHeader('bytes=0-'), { present: true, shape: 'bytes=0-' });
  assert.deepEqual(describeSafeRangeHeader('users=secret'), { present: true, shape: 'invalid' });
});

test('success requires 2xx plus media-compatible bytes and rejects HTML/JSON', () => {
  assert.equal(isLiveRequestContractSuccess({ httpStatus: 200, classification: 'media' }), true);
  assert.equal(isLiveRequestContractSuccess({ httpStatus: 206, classification: 'media' }), true);
  assert.equal(isLiveRequestContractSuccess({ httpStatus: 200, classification: 'html' }), false);
  assert.equal(isLiveRequestContractSuccess({ httpStatus: 406, classification: 'error' }), false);
  assert.equal(isLiveRequestContractSuccess({ httpStatus: 503, classification: 'error' }), false);
  assert.equal(isLiveRequestContractSuccess({ httpStatus: 302, classification: 'error' }), false);
});

test('audit runs GET variants sequentially and proves a single-header fix', async () => {
  const seen = [];
  const results = await runLiveRequestContractAudit({
    constructedUrl: AUTH_URL,
    yieldMs: 0,
    fetchImpl: async (input, init) => {
      seen.push({
        method: init.method,
        ua: new Headers(init.headers).get('User-Agent'),
        accept: new Headers(init.headers).get('Accept'),
        range: new Headers(init.headers).get('Range'),
        connection: new Headers(init.headers).get('Connection'),
        redirect: init.redirect,
      });
      const headers = new Headers(init.headers);
      if (headers.get('User-Agent') === LIVE_VLC_USER_AGENT) {
        return jsonResponse(200, { body: TS_BYTES, contentType: 'video/mp2t' });
      }
      return jsonResponse(406, { body: new TextEncoder().encode(HTML_BODY), contentType: 'text/html' });
    },
  });

  assert.equal(seen.length, 7);
  assert.equal(seen.every((item) => item.method === 'GET'), true);
  assert.equal(results.find((item) => item.variantId === 'baseline')?.success, false);
  assert.equal(results.find((item) => item.variantId === 'ua-vlc')?.success, true);
  assert.equal(results.find((item) => item.variantId === 'ua-exoplayer')?.success, false);
  assert.deepEqual(selectProvenLiveRequestContractFix(results), {
    variantId: 'ua-vlc',
    changedField: 'user-agent',
  });
});

test('200 HTML and 200 JSON are rejected even when status looks healthy', async () => {
  const html = await runLiveRequestContractAudit({
    constructedUrl: AUTH_URL,
    yieldMs: 0,
    fetchImpl: async () => jsonResponse(200, { body: new TextEncoder().encode(HTML_BODY), contentType: 'text/html' }),
  });
  assert.equal(html.every((item) => item.success === false), true);
  assert.equal(html[0].classification, 'html');

  const json = await runLiveRequestContractAudit({
    constructedUrl: AUTH_URL,
    yieldMs: 0,
    fetchImpl: async () =>
      jsonResponse(200, { body: new TextEncoder().encode('{"error":true}'), contentType: 'application/json' }),
  });
  assert.equal(json.every((item) => item.success === false), true);
});

test('all failing variants produce no proven request-contract fix', async () => {
  const results = await runLiveRequestContractAudit({
    constructedUrl: AUTH_URL,
    yieldMs: 0,
    fetchImpl: async () => jsonResponse(503, { body: new TextEncoder().encode(HTML_BODY), contentType: 'text/html' }),
  });
  assert.equal(selectProvenLiveRequestContractFix(results), null);
  assert.equal(results.every((item) => item.success === false), true);
});

test('safe logs omit credentials and raw Location URLs', async () => {
  const { lines } = await captureInfo(async () => {
    logExpectedLiveRequestContractComparison();
    await scheduleLiveRequestContractAudit({
      providerId: 'xtream-test',
      constructedUrl: AUTH_URL,
      yieldMs: 0,
      fetchImpl: async () =>
        jsonResponse(302, {
          body: new Uint8Array(),
          contentType: 'text/html',
          location: 'https://cdn.example/live/user/secret/201.ts',
        }),
    });
  });
  assert.equal(lines.some((line) => line.includes(LIVE_REQUEST_CONTRACT_DIAG)), true);
  assert.match(lines.join('\n'), /"locationPathShape":"\/live\/\{user\}\/\{pass\}\/\{streamId\}\.ts"/);
  assert.match(lines.join('\n'), /"httpToHttpsRedirect":true/);
  assertNoSecrets(lines);
  assert.equal(lines.join('\n').includes('cdn.example'), false);
});
