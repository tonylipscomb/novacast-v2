import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  NOVACAST_STREAM_PROBE_UA,
  sanitizeHealthSummary,
} from './providerHealth.ts';
import { probeStream, runProviderHealthCheck } from './providerHealthRunner.ts';

const USER = 'secretuser';
const PASS = 'secretpass';
const BASE = 'http://cdn.example.com:8080';

function mpegTs(bytes = 188 * 3) {
  const ts = new Uint8Array(bytes);
  for (let offset = 0; offset + 1 < bytes; offset += 188) ts[offset] = 0x47;
  return ts;
}

function mp4Header() {
  const bytes = new Uint8Array(32);
  bytes.set([0x66, 0x74, 0x79, 0x70], 4);
  return bytes;
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mediaResponse(body: Uint8Array | string, status = 200, contentType = 'video/mp2t') {
  return new Response(body as BodyInit, {
    status,
    headers: { 'content-type': contentType },
  });
}

async function withFetch<T>(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response, run: () => Promise<T>) {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(handler(input, init))) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

function requestUrl(input: RequestInfo | URL) {
  return String(input instanceof Request ? input.url : input);
}

Deno.test('Range 416 then bounded GET succeeds as MPEG-TS', async () => {
  let sawRange = false;
  let sawPlain = false;
  const result = await withFetch((input, init) => {
    const headers = new Headers(init?.headers);
    if (headers.get('range')) {
      sawRange = true;
      return new Response('range not supported', { status: 416 });
    }
    sawPlain = true;
    assertEquals(headers.get('user-agent'), NOVACAST_STREAM_PROBE_UA);
    return mediaResponse(mpegTs(), 200, 'video/mp2t');
  }, () =>
    probeStream({
      credentials: { baseUrl: BASE, username: USER, password: PASS },
      kind: 'live',
      streamId: '100',
      extension: 'ts',
    }));
  assert(sawRange && sawPlain);
  assertEquals(result.ok, true);
  assertEquals(result.rangeRetried, true);
  assertEquals(result.mediaHint, 'mpegts');
  assertEquals(result.code, 'ok');
});

Deno.test('stream HTTP 401 403 404 and 429 keep distinct codes', async () => {
  for (const status of [401, 403, 404, 429] as const) {
    const result = await withFetch(() => new Response('denied', { status }), () =>
      probeStream({
        credentials: { baseUrl: BASE, username: USER, password: PASS },
        kind: 'movie',
        streamId: '9',
        extension: 'mp4',
        maxConnections: 3,
        activeConnections: 0,
      }));
    assertEquals(result.ok, false);
    assertEquals(result.httpStatus, status);
    assertEquals(result.code, `stream_http_${status}`);
    assert(!JSON.stringify(result).includes(USER));
    assert(!JSON.stringify(result).includes(PASS));
  }
});

Deno.test('redirect to a private host is blocked by SSRF validation', async () => {
  const result = await withFetch(() =>
    new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/stream.ts' } }), () =>
    probeStream({
      credentials: { baseUrl: BASE, username: USER, password: PASS },
      kind: 'live',
      streamId: '1',
      extension: 'ts',
    }));
  assertEquals(result.ok, false);
  assertEquals(result.code, 'stream_redirect_blocked');
});

Deno.test('public redirect is followed and HLS is accepted', async () => {
  const result = await withFetch((input) => {
    const url = requestUrl(input);
    if (url.includes('/live/')) {
      return new Response(null, { status: 302, headers: { location: 'https://cdn.example.net/playlist.m3u8' } });
    }
    return mediaResponse('#EXTM3U\n#EXTINF:1,\nseg.ts\n', 200, 'application/vnd.apple.mpegurl');
  }, () =>
    probeStream({
      credentials: { baseUrl: BASE, username: USER, password: PASS },
      kind: 'live',
      streamId: '7',
      extension: 'm3u8',
    }));
  assertEquals(result.ok, true);
  assertEquals(result.redirected, true);
  assertEquals(result.mediaHint, 'hls');
});

Deno.test('HTML login page is not treated as playable media', async () => {
  const result = await withFetch(
    () => mediaResponse('<!doctype html><html><body>login</body></html>', 200, 'text/html'),
    () =>
      probeStream({
        credentials: { baseUrl: BASE, username: USER, password: PASS },
        kind: 'movie',
        streamId: '12',
        extension: 'mp4',
      }),
  );
  assertEquals(result.ok, false);
  assertEquals(result.code, 'stream_html_response');
});

Deno.test('valid MP4 ftyp header passes the movie probe', async () => {
  const result = await withFetch(() => mediaResponse(mp4Header(), 200, 'video/mp4'), () =>
    probeStream({
      credentials: { baseUrl: BASE, username: USER, password: PASS },
      kind: 'movie',
      streamId: '44',
      extension: 'mkv',
    }));
  assertEquals(result.ok, true);
  assertEquals(result.mediaHint, 'mp4');
});

function catalogPayload(action: string | null) {
  if (!action) {
    return {
      user_info: {
        auth: 1,
        status: 'Active',
        max_connections: '1',
        active_cons: '0',
        allowed_output_formats: ['ts', 'm3u8', 'mp4'],
      },
      server_info: { timezone: 'UTC' },
    };
  }
  if (action === 'get_live_categories') return [{ category_id: '1', category_name: 'USA' }];
  if (action === 'get_vod_categories') return [{ category_id: '2', category_name: 'Movies' }];
  if (action === 'get_series_categories') return [{ category_id: '3', category_name: 'Series' }];
  if (action === 'get_live_streams') {
    return [
      { stream_id: 11, name: 'News 1', container_extension: 'ts' },
      { stream_id: 12, name: 'News 2', container_extension: 'm3u8' },
      { stream_id: 13, name: 'News 3', container_extension: 'ts' },
    ];
  }
  if (action === 'get_vod_streams') {
    return [
      { stream_id: 21, name: 'Film A', container_extension: 'mkv' },
      { stream_id: 22, name: 'Film B', container_extension: 'mp4' },
    ];
  }
  if (action === 'get_series') return [{ series_id: 31, name: 'Show A' }];
  if (action === 'get_series_info') {
    return {
      episodes: {
        '1': [
          { id: 41, title: 'E1', container_extension: 'mp4' },
          { id: 42, title: 'E2', container_extension: 'mkv' },
        ],
      },
    };
  }
  if (action === 'get_short_epg') return { epg_listings: [{ title: 'Now' }, { title: 'Next' }] };
  return [];
}

Deno.test('occupied max_connections=1 skips stream probes and does not fail as broken playback', async () => {
  let streamGets = 0;
  const summary = await withFetch((input) => {
    const url = new URL(requestUrl(input));
    if (url.pathname.includes('/live/') || url.pathname.includes('/movie/') || url.pathname.includes('/series/')) {
      streamGets += 1;
      return mediaResponse(mpegTs());
    }
    if (url.pathname === '/') return new Response('auth', { status: 401 });
    const action = url.searchParams.get('action');
    const payload = catalogPayload(action);
    if (!action && payload && typeof payload === 'object' && !Array.isArray(payload)) {
      (payload as { user_info: Record<string, unknown> }).user_info.active_cons = '1';
    }
    return jsonResponse(payload);
  }, () => runProviderHealthCheck({ baseUrl: BASE, username: USER, password: PASS }));

  assertEquals(streamGets, 0);
  const playback = summary.checks.find((check) => check.id === 'playback');
  assertEquals(playback?.verdict, 'warn');
  assertEquals(playback?.severity, 'noncritical');
  assert(String(playback?.detail).includes('single allowed connection'));
  assertEquals(summary.overall, 'degraded');
  const blob = JSON.stringify(sanitizeHealthSummary(summary, USER, PASS));
  assert(!blob.includes(USER));
  assert(!blob.includes(PASS));
});

Deno.test('sequential probes never overlap and credentials stay out of diagnostics', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  let streamGets = 0;
  const requested = new Set<string>();
  const summary = await withFetch(async (input, init) => {
    const url = new URL(requestUrl(input));
    const headers = new Headers(init?.headers);
    if (url.pathname.includes('/live/') || url.pathname.includes('/movie/') || url.pathname.includes('/series/')) {
      streamGets += 1;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      requested.add(`${url.pathname.split('/').slice(0, 2).join('/')}::${url.pathname.split('.').pop()}`);
      assertEquals(headers.get('user-agent'), NOVACAST_STREAM_PROBE_UA);
      await new Promise((resolve) => setTimeout(resolve, 25));
      inFlight -= 1;
      if (url.pathname.includes('/movie/')) return mediaResponse(mp4Header(), 200, 'video/mp4');
      if (url.pathname.endsWith('.m3u8')) return mediaResponse('#EXTM3U\n#EXTINF:1,\nseg.ts\n', 200, 'application/vnd.apple.mpegurl');
      return mediaResponse(mpegTs());
    }
    if (url.pathname === '/') return new Response('auth', { status: 401 });
    return jsonResponse(catalogPayload(url.searchParams.get('action')));
  }, () => runProviderHealthCheck({ baseUrl: BASE, username: USER, password: PASS }));

  assertEquals(maxInFlight, 1);
  assert(streamGets >= 7);
  assert(requested.has('/live::ts') || [...requested].some((item) => item.startsWith('/live::')));
  const playback = summary.checks.find((check) => check.id === 'playback');
  assertEquals(playback?.verdict, 'pass');
  const blob = JSON.stringify(sanitizeHealthSummary(summary, USER, PASS));
  assert(!blob.includes(USER));
  assert(!blob.includes(PASS));
  assert(!blob.includes('/live/secretuser/'));
});
