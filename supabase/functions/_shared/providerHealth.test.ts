import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@1';
import {
  aggregateStreamProbeCheck,
  buildXtreamStreamUrl,
  canActivateFromHealth,
  classifyOverallHealth,
  classifyStreamProbePayload,
  connectionSlotOccupied,
  displayHealthLabel,
  formatStreamProbeDiagnostic,
  isBlockedProviderHost,
  maybeConnectionLimitCode,
  normalizePlaybackExtension,
  parseOptionalInt,
  parseProviderBaseUrl,
  pickRepresentativeIndexes,
  sanitizeCredentialUrl,
  sanitizeFailureMessage,
  sanitizeHealthSummary,
  shouldRetryStreamWithoutRange,
  streamProbeMessage,
  type ProviderHealthSummary,
  type StreamProbeResult,
} from './providerHealth.ts';

Deno.test('blocks localhost, private, metadata, and non-http URLs', () => {
  assert(isBlockedProviderHost('localhost'));
  assert(isBlockedProviderHost('127.0.0.1'));
  assert(isBlockedProviderHost('10.0.0.8'));
  assert(isBlockedProviderHost('192.168.1.9'));
  assert(isBlockedProviderHost('169.254.169.254'));
  assert(isBlockedProviderHost('::1'));
  assert(!isBlockedProviderHost('example.com'));
  assert(!isBlockedProviderHost('fc.cdn.example'));
  assertThrows(() => parseProviderBaseUrl('http://127.0.0.1'), Error, 'unsafe_provider_target');
  assertThrows(() => parseProviderBaseUrl('http://localhost'), Error, 'unsafe_provider_target');
  assertThrows(() => parseProviderBaseUrl('file:///etc/passwd'), Error, 'invalid_provider_url');
  assertThrows(() => parseProviderBaseUrl('ftp://example.com'), Error, 'invalid_provider_url');
});

Deno.test('accepts public http URLs and strips player_api.php', () => {
  assertEquals(parseProviderBaseUrl('http://example.com/player_api.php').origin, 'http://example.com');
  assertEquals(parseProviderBaseUrl('http://example.com:8080/').host, 'example.com:8080');
  assertEquals(parseProviderBaseUrl('https://cdn.example.com').protocol, 'https:');
});

Deno.test('sanitizes credential-bearing URLs and messages', () => {
  const raw = 'http://provider.com:8080/live/myusername/mypassword/37264.ts';
  const clean = sanitizeCredentialUrl(raw, 'myusername', 'mypassword');
  assert(!clean.includes('myusername'));
  assert(!clean.includes('mypassword'));
  assert(clean.includes('/***/***/'));
  const message = sanitizeFailureMessage('password=secret&username=myusername', 'myusername', 'secret');
  assert(!message.includes('secret'));
  assert(!message.includes('myusername'));
});

Deno.test('classifies HTML 200 as stream probe failure', () => {
  const html = classifyStreamProbePayload({
    httpStatus: 200,
    contentType: 'text/html',
    bytes: new TextEncoder().encode('<html>login</html>'),
  });
  assertEquals(html.ok, false);
  assertEquals(html.code, 'stream_html_response');
});

Deno.test('classifies HLS MPEG-TS and MP4 payloads as stream probe success', () => {
  const hls = classifyStreamProbePayload({
    httpStatus: 200,
    contentType: 'application/vnd.apple.mpegurl',
    bytes: new TextEncoder().encode('#EXTM3U\n#EXTINF:1,\nseg.ts'),
  });
  assertEquals(hls.ok, true);
  assertEquals(hls.mediaHint, 'hls');
  const ts = new Uint8Array(188 * 3);
  ts[0] = 0x47;
  ts[188] = 0x47;
  ts[376] = 0x47;
  const mpeg = classifyStreamProbePayload({ httpStatus: 206, contentType: 'video/mp2t', bytes: ts });
  assertEquals(mpeg.ok, true);
  assertEquals(mpeg.mediaHint, 'mpegts');
  const mp4 = new Uint8Array(32);
  mp4.set([0x66, 0x74, 0x79, 0x70], 4);
  const mp4Result = classifyStreamProbePayload({ httpStatus: 200, contentType: 'video/mp4', bytes: mp4 });
  assertEquals(mp4Result.ok, true);
  assertEquals(mp4Result.mediaHint, 'mp4');
});

Deno.test('classifies stream HTTP 401 403 404 and 429 distinctly', () => {
  assertEquals(classifyStreamProbePayload({ httpStatus: 401 }).code, 'stream_http_401');
  assertEquals(classifyStreamProbePayload({ httpStatus: 403 }).code, 'stream_http_403');
  assertEquals(classifyStreamProbePayload({ httpStatus: 404 }).code, 'stream_http_404');
  assertEquals(classifyStreamProbePayload({ httpStatus: 429 }).code, 'stream_http_429');
  assertEquals(classifyStreamProbePayload({ httpStatus: 416 }).code, 'stream_range_rejected');
});

Deno.test('health aggregation treats playback failure as failed and EPG as degraded', () => {
  const failed = classifyOverallHealth([
    { id: 'authentication', label: 'Authentication', verdict: 'pass', severity: 'critical', detail: 'ok' },
    { id: 'playback', label: 'Stream Probe', verdict: 'fail', severity: 'critical', detail: 'Playback endpoints failed.' },
  ]);
  assertEquals(failed.overall, 'failed');

  const degraded = classifyOverallHealth([
    { id: 'authentication', label: 'Authentication', verdict: 'pass', severity: 'critical', detail: 'ok' },
    { id: 'playback', label: 'Stream Probe', verdict: 'pass', severity: 'critical', detail: '3/3' },
    { id: 'epg', label: 'EPG', verdict: 'warn', severity: 'noncritical', detail: 'EPG unavailable.' },
  ]);
  assertEquals(degraded.overall, 'degraded');

  const connectionLimit = classifyOverallHealth([
    { id: 'authentication', label: 'Authentication', verdict: 'pass', severity: 'critical', detail: 'ok' },
    { id: 'playback', label: 'Stream Probe', verdict: 'warn', severity: 'noncritical', detail: streamProbeMessage('stream_connection_limit') },
  ]);
  assertEquals(connectionLimit.overall, 'degraded');

  const healthy = classifyOverallHealth([
    { id: 'server', label: 'Server', verdict: 'pass', severity: 'critical', detail: 'ok' },
    { id: 'playback', label: 'Stream Probe', verdict: 'pass', severity: 'critical', detail: 'ok' },
  ]);
  assertEquals(healthy.overall, 'healthy');
});

Deno.test('activation requires non-stale healthy or degraded health', () => {
  assertEquals(canActivateFromHealth({ healthStatus: 'healthy', validationStale: false, activationStatus: 'draft' }), true);
  assertEquals(canActivateFromHealth({ healthStatus: 'degraded', validationStale: false, activationStatus: 'paused' }), true);
  assertEquals(canActivateFromHealth({ healthStatus: 'failed', validationStale: false, activationStatus: 'draft' }), false);
  assertEquals(canActivateFromHealth({ healthStatus: 'healthy', validationStale: true, activationStatus: 'draft' }), false);
  assertEquals(displayHealthLabel({ activationStatus: 'active', healthStatus: 'failed', validationStale: false }), 'FAILED');
  assertEquals(displayHealthLabel({ activationStatus: 'active', healthStatus: 'healthy', validationStale: true }), 'VALIDATION REQUIRED');
});

Deno.test('representative sampling does not always choose the first index', () => {
  const indexes = pickRepresentativeIndexes(100, 3);
  assertEquals(indexes.length, 3);
  assert(!indexes.every((index) => index === 0));
});

Deno.test('parseOptionalInt preserves zero active connections', () => {
  assertEquals(parseOptionalInt(0), 0);
  assertEquals(parseOptionalInt('0'), 0);
  assertEquals(parseOptionalInt('1'), 1);
  assertEquals(parseOptionalInt(''), null);
  assertEquals(parseOptionalInt(undefined), null);
});

Deno.test('max_connections=1 and active_cons=1 is occupied, not a dead endpoint', () => {
  assertEquals(connectionSlotOccupied(1, 1), true);
  assertEquals(connectionSlotOccupied(1, 2), true);
  assertEquals(connectionSlotOccupied(1, 0), false);
  assertEquals(connectionSlotOccupied(1, null), false);
  assertEquals(connectionSlotOccupied(2, 1), false);
  const skipped = aggregateStreamProbeCheck({
    probes: [],
    skippedForConnectionLimit: true,
    live: { passed: 0, total: 0 },
    movies: { passed: 0, total: 0 },
    episodes: { passed: 0, total: 0 },
  });
  assertEquals(skipped.verdict, 'warn');
  assertEquals(skipped.severity, 'noncritical');
  assert(skipped.detail.includes('single allowed connection'));
  assert(!skipped.detail.includes('playback endpoints are rejecting'));
});

Deno.test('403 with a free slot stays HTTP 403; occupied or unknown max=1 maps to connection limit', () => {
  assertEquals(maybeConnectionLimitCode('stream_http_403', 1, 0), 'stream_http_403');
  assertEquals(maybeConnectionLimitCode('stream_http_403', 1, 1), 'stream_connection_limit');
  assertEquals(maybeConnectionLimitCode('stream_http_403', 1, null), 'stream_connection_limit');
  assertEquals(maybeConnectionLimitCode('stream_http_401', 1, 1), 'stream_http_401');
  assertEquals(maybeConnectionLimitCode('stream_http_429', 2, 1), 'stream_http_429');
});

Deno.test('Range rejection statuses are eligible for one bounded GET fallback', () => {
  assert(shouldRetryStreamWithoutRange(416));
  assert(shouldRetryStreamWithoutRange(405));
  assert(shouldRetryStreamWithoutRange(406));
  assert(shouldRetryStreamWithoutRange(501));
  assert(!shouldRetryStreamWithoutRange(401));
  assert(!shouldRetryStreamWithoutRange(403));
  assert(!shouldRetryStreamWithoutRange(200));
});

Deno.test('canonical stream URLs match NovaCast live movie and episode builders', () => {
  const liveTs = buildXtreamStreamUrl({
    baseUrl: 'http://cdn.example.com:8080',
    username: 'user name',
    password: 'p@ss/word',
    kind: 'live',
    streamId: '37264',
    extension: 'ts',
  });
  assertEquals(liveTs, 'http://cdn.example.com:8080/live/user%20name/p%40ss%2Fword/37264.ts');

  const liveHls = buildXtreamStreamUrl({
    baseUrl: 'http://cdn.example.com:8080',
    username: 'user',
    password: 'pass',
    kind: 'live',
    streamId: '99',
    extension: 'm3u8',
  });
  assertEquals(liveHls, 'http://cdn.example.com:8080/live/user/pass/99.m3u8');

  const movie = buildXtreamStreamUrl({
    baseUrl: 'http://cdn.example.com:8080',
    username: 'user',
    password: 'pass',
    kind: 'movie',
    streamId: '55',
    extension: 'mkv',
  });
  assertEquals(movie, 'http://cdn.example.com:8080/movie/user/pass/55.mkv');

  const episode = buildXtreamStreamUrl({
    baseUrl: 'http://cdn.example.com:8080',
    username: 'user',
    password: 'pass',
    kind: 'episode',
    streamId: '88',
    extension: 'mp4',
  });
  assertEquals(episode, 'http://cdn.example.com:8080/series/user/pass/88.mp4');
});

Deno.test('playback extensions use catalog container_extension, including duplicated suffixes', () => {
  assertEquals(normalizePlaybackExtension('ts', 'ts'), 'ts');
  assertEquals(normalizePlaybackExtension('.m3u8', 'ts'), 'm3u8');
  assertEquals(normalizePlaybackExtension('mp4.mp4', 'mp4'), 'mp4');
  assertEquals(normalizePlaybackExtension('MKV', 'mp4'), 'mkv');
  assertEquals(normalizePlaybackExtension('', 'ts'), 'ts');
  assertEquals(normalizePlaybackExtension(undefined, 'mp4'), 'mp4');
});

Deno.test('aggregate stream probe reports precise HTTP reason codes instead of a collapsed sentence', () => {
  const probes: StreamProbeResult[] = [
    { kind: 'live', ok: false, latencyMs: 10, httpStatus: 401, reason: streamProbeMessage('stream_http_401'), code: 'stream_http_401' },
    { kind: 'movie', ok: false, latencyMs: 10, httpStatus: 401, reason: streamProbeMessage('stream_http_401'), code: 'stream_http_401' },
    { kind: 'episode', ok: false, latencyMs: 10, httpStatus: 401, reason: streamProbeMessage('stream_http_401'), code: 'stream_http_401' },
  ];
  const result = aggregateStreamProbeCheck({
    probes,
    skippedForConnectionLimit: false,
    live: { passed: 0, total: 1 },
    movies: { passed: 0, total: 1 },
    episodes: { passed: 0, total: 1 },
  });
  assertEquals(result.verdict, 'fail');
  assert(result.detail.includes('HTTP 401'));
  assert(result.detail.includes('stream_http_401'));
  assert(!result.detail.includes('playback endpoints are rejecting stream requests'));
});

Deno.test('sanitized probe diagnostics never include credentials', () => {
  const diagnostic = formatStreamProbeDiagnostic({
    kind: 'live',
    ok: false,
    latencyMs: 12,
    httpStatus: 403,
    reason: streamProbeMessage('stream_http_403'),
    code: 'stream_http_403',
    contentType: 'text/html',
    byteCount: 128,
    redirected: false,
  });
  assert(!diagnostic.includes('secretuser'));
  assert(!diagnostic.includes('secretpass'));
  assert(!/https?:\/\//i.test(diagnostic));
  const summary = sanitizeHealthSummary(
    {
      overall: 'failed',
      overallLabel: 'http://cdn.example.com/live/secretuser/secretpass/1.ts',
      testedAt: new Date().toISOString(),
      durationMs: 1,
      checks: [{
        id: 'playback',
        label: 'Stream Probe',
        verdict: 'fail',
        severity: 'critical',
        detail: 'http://cdn.example.com/live/secretuser/secretpass/1.ts HTTP 401',
      }],
      notes: ['http://cdn.example.com/live/secretuser/secretpass/1.ts'],
      decoderCaveat: 'ok',
    } satisfies ProviderHealthSummary,
    'secretuser',
    'secretpass',
  );
  const blob = JSON.stringify(summary);
  assert(!blob.includes('secretuser'));
  assert(!blob.includes('secretpass'));
});
