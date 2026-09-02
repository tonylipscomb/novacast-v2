import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8');

test('provider runtime audit tags error mutations without changing runtime state shape', () => {
  const source = read('src/features/providers/providerStore.ts');

  assert.match(source, /function setRuntime\(next: ProviderRuntimeState, source: ProviderRuntimeAuditSource\)/);
  assert.match(source, /provider-switch-error-set/);
  assert.match(source, /provider-switch-error-cleared/);
  for (const sourceTag of [
    'background-account-validation-failure',
    'saved-provider-init-failure',
    'persistence-migration-failure',
    'provider-switch-start',
    'provider-switch-success',
    'provider-switch-failure',
    'xtream-connect-start',
    'xtream-connect-success',
    'xtream-connect-failure',
    'retry-start',
    'retry-success',
    'retry-failure',
    'reset',
    'resolve-startup-already-active-clear',
  ]) {
    assert.match(source, new RegExp(`'${sourceTag}'`));
  }
  assert.match(source, /runtime = next;\s*emitRuntimeChange\(\);/);
});

test('provider runtime audit is gated and excludes secrets, URLs, and raw errors', () => {
  const source = read('src/features/providers/providerStore.ts');
  const auditLogger = source.slice(
    source.indexOf('function logProviderRuntimeAudit'),
    source.indexOf('function setRuntime'),
  );

  assert.match(source, /EXPO_PUBLIC_NOVACAST_HOME_PRESENTATION_AUDIT === '1'/);
  assert.match(auditLogger, /errorKind: next\.lastError \? 'provider_runtime_error' : null/);
  assert.doesNotMatch(auditLogger, /baseUrl|username|password|rawError|rawResponse/);
});

test('StartupGate deduplicates safe provider error snapshots', () => {
  const source = read('src/features/startup/StartupGate.tsx');

  assert.match(source, /provider-error-state-snapshot/);
  assert.match(source, /providerErrorSnapshotSignatureRef/);
  assert.match(source, /if \(signature === providerErrorSnapshotSignatureRef\.current\)/);
  for (const field of [
    'bundlePresent',
    'bundleProviderId',
    'selectedProviderId',
    'providerSwitchErrorPresent',
    'providerSwitchErrorReason',
    'providerInitialized',
    'effectiveAuthorized',
    'checking',
    'retrying',
    'startupState',
    'providerBootstrapRequested',
    'requiresProviderDownload',
  ]) {
    assert.match(source, new RegExp(`${field}(?::|,)`));
  }
});
