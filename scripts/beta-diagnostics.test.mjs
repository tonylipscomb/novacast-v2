import assert from 'node:assert/strict';
import test from 'node:test';
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

test('diagnostics classifier follows deterministic provider and decoder rules', () => {
  assert.equal(classifyDiagnostics({ providerLatencyMs: 9000 }).cause, 'PROVIDER_API');
  assert.equal(classifyDiagnostics({ streamTimedOut: true, providerLatencyMs: 120 }).cause, 'STREAM_SERVER');
  assert.equal(classifyDiagnostics({ decoderError: true }).cause, 'PLAYBACK_DECODER');
  assert.equal(classifyDiagnostics({ networkFailures: 4 }).cause, 'DEVICE_NETWORK');
  assert.equal(classifyDiagnostics({}).cause, 'HEALTHY');
});
