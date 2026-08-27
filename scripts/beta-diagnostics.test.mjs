import assert from 'node:assert/strict';
import test from 'node:test';
import { redact } from '../supabase/functions/diagnostics-ingest/sanitizer.ts';
import { sanitizeDiagnosticMetadata, sanitizeStreamReference } from '../src/features/diagnostics/diagnosticsSanitizer.ts';
import { classifyDiagnostics } from '../src/features/diagnostics/diagnosticClassifier.ts';

test('diagnostics sanitizer removes credentials and keeps stream host only', () => {
  const value = sanitizeDiagnosticMetadata({
    streamUrl: 'https://alice:secret@example.test:8080/live/alice/secret/814.ts?token=abc',
    Authorization: 'Bearer secret',
    nested: { password: 'secret', status: 504 },
  });
  assert.equal('streamUrl' in value, false);
  assert.equal('Authorization' in value, false);
  assert.deepEqual(value.nested, { status: 504 });
  assert.deepEqual(sanitizeStreamReference('https://alice:secret@example.test/live/814.ts'), { streamHost: 'example.test' });
});

test('Edge diagnostics sanitizer preserves titles and redacts only URL fields', () => {
  const value = redact({
    contentTitle: '24/7: DARIA',
    alternateTitle: 'ESPN: The Ocho',
    contentId: '24/7: AMERICAN HOUSEWIFE',
    contentType: 'live',
    route: '/live',
    streamUrl: 'https://user:pass@example.tv/live/user/pass/123.m3u8?token=abc',
    nested: { source_uri: 'rtsp://example.tv/live/channel', password: 'secret', token: 'hidden' },
    password: 'removed',
  });

  assert.equal(value.contentTitle, '24/7: DARIA');
  assert.equal(value.alternateTitle, 'ESPN: The Ocho');
  assert.equal(value.contentId, '24/7: AMERICAN HOUSEWIFE');
  assert.equal(value.contentType, 'live');
  assert.equal(value.route, '/live');
  assert.deepEqual(value.streamUrl, { streamHost: 'example.tv', protocol: 'https:' });
  assert.deepEqual(value.nested, { source_uri: { streamHost: 'example.tv', protocol: 'rtsp:' } });
  assert.equal('password' in value, false);
  assert.equal('password' in value.nested, false);
  assert.equal('token' in value.nested, false);
});

test('diagnostics classifier follows deterministic provider and decoder rules', () => {
  assert.equal(classifyDiagnostics({ providerLatencyMs: 9000 }).cause, 'PROVIDER_API');
  assert.equal(classifyDiagnostics({ streamTimedOut: true, providerLatencyMs: 120 }).cause, 'STREAM_SERVER');
  assert.equal(classifyDiagnostics({ decoderError: true }).cause, 'PLAYBACK_DECODER');
  assert.equal(classifyDiagnostics({ networkFailures: 4 }).cause, 'DEVICE_NETWORK');
  assert.equal(classifyDiagnostics({}).cause, 'HEALTHY');
});
