import assert from 'node:assert/strict';
import test from 'node:test';

import {
  doesApkSha256Match,
  parseUpdateManifest,
  resolveUpdateDecision,
} from '../src/features/updates/updateCenter.ts';

const validManifest = {
  packageName: 'com.novacast.novacastv2',
  versionName: '1.0.10',
  versionCode: 45,
  apkUrl: 'https://novacast-connect.netlify.app/downloads/novacast.apk',
  sha256: 'A'.repeat(64),
};

test('rejects malformed manifests and package mismatches', () => {
  assert.equal(parseUpdateManifest({ ...validManifest, packageName: 'other.app' }), null);
  assert.equal(parseUpdateManifest({ ...validManifest, sha256: 'not-a-checksum' }), null);
  assert.equal(parseUpdateManifest({ ...validManifest, apkUrl: 'file:///private.apk' }), null);
});

test('returns no-update when installed version is current or newer', () => {
  assert.deepEqual(resolveUpdateDecision(45, validManifest), {
    kind: 'no-update',
    installedVersionCode: 45,
  });
  assert.deepEqual(resolveUpdateDecision(46, validManifest), {
    kind: 'no-update',
    installedVersionCode: 46,
  });
});

test('returns a validated update only for a higher version code', () => {
  const result = resolveUpdateDecision(44, validManifest);
  assert.equal(result.kind, 'available');
  if (result.kind === 'available') {
    assert.equal(result.manifest.packageName, 'com.novacast.novacastv2');
    assert.equal(result.manifest.versionCode, 45);
  }
});

test('checksum comparison is case-insensitive but format strict', () => {
  assert.equal(doesApkSha256Match('A'.repeat(64), 'a'.repeat(64)), true);
  assert.equal(doesApkSha256Match('A'.repeat(63), 'a'.repeat(63)), false);
  assert.equal(doesApkSha256Match('A'.repeat(64), 'b'.repeat(64)), false);
});
