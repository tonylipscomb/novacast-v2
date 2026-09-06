import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyProviderFailure,
  isPermanentProviderFailure,
} from '../src/features/resilience/providerFailureClassifier.ts';
import {
  buildDiagnosticCode,
  clearSanitizedDiagnosticsForTests,
  getSanitizedDiagnostics,
  recordSanitizedDiagnostic,
} from '../src/features/resilience/sanitizedDiagnostics.ts';
import {
  getOfflineSnapshot,
  reportNetworkOutcome,
  resetOfflineStatusForTests,
  shouldAnnounceOfflineOutage,
} from '../src/features/resilience/offlineStatus.ts';
import {
  resolveManagedLibraryMissingState,
  withTimeout,
} from '../src/features/startup/startupTimeouts.ts';
import {
  UNIFIED_PLAYER_BUFFERING_TIMEOUT_MS,
  UNIFIED_PLAYER_LOADING_TIMEOUT_MS,
} from '../src/features/playback/unified/unifiedPlayerLogic.ts';

test('provider timeout is not classified as invalid credentials', () => {
  const classified = classifyProviderFailure(new Error('Request timed out'));
  assert.equal(classified.kind, 'timeout');
  assert.equal(classified.autoRetrySafe, true);
  assert.equal(isPermanentProviderFailure(classified.kind), false);
});

test('invalid credentials are permanent and not auto-retried', () => {
  const classified = classifyProviderFailure(new Error('401 unauthorized invalid password'));
  assert.equal(classified.kind, 'invalid_credentials');
  assert.equal(classified.autoRetrySafe, false);
  assert.equal(isPermanentProviderFailure(classified.kind), true);
});

test('offline and expired account have distinct user messages', () => {
  const offline = classifyProviderFailure(new Error('Network request failed'));
  const expired = classifyProviderFailure(new Error('Account expired'));
  assert.equal(offline.kind, 'offline');
  assert.equal(expired.kind, 'expired_account');
  assert.notEqual(offline.message, expired.message);
});

test('startup timeout helper rejects after bound', async () => {
  await assert.rejects(
    () => withTimeout(new Promise(() => undefined), 20, 'device_status_timeout'),
    /device_status_timeout/,
  );
});

test('managed library missing without assignment is actionable', () => {
  assert.equal(
    resolveManagedLibraryMissingState({
      closedBeta: true,
      providerAssigned: false,
      requiresProviderDownload: false,
      hasProvider: false,
    }),
    'actionable_error',
  );
});

test('offline status dedupes outage announcements', () => {
  resetOfflineStatusForTests();
  reportNetworkOutcome(false);
  reportNetworkOutcome(false);
  reportNetworkOutcome(false);
  assert.equal(getOfflineSnapshot().status, 'offline');
  assert.equal(shouldAnnounceOfflineOutage(), true);
  assert.equal(shouldAnnounceOfflineOutage(), false);
});

test('provider failures do not mark the device offline', () => {
  resetOfflineStatusForTests();
  reportNetworkOutcome(false, 'provider');
  reportNetworkOutcome(false, 'provider');
  reportNetworkOutcome(false, 'provider');
  assert.equal(getOfflineSnapshot().status, 'unknown');
});

test('sanitized diagnostics redact sensitive detail and never store secrets', () => {
  clearSanitizedDiagnosticsForTests();
  recordSanitizedDiagnostic({
    operation: 'provider_connect',
    screen: 'startup',
    errorType: 'timeout',
    detail: 'password=supersecret&token=abc',
    outcome: 'failed',
  });
  const events = getSanitizedDiagnostics();
  assert.equal(events.length, 1);
  assert.equal(events[0].detail, '[redacted]');
  assert.match(
    buildDiagnosticCode({ version: '1.0.1', activation: 'active', network: 'online', lastErrorType: 'timeout' }),
    /^NC-1\.0\.1-ACTIVE-ONLINE-TIMEOUT-/,
  );
});

test('playback loading and buffering timeouts are bounded', () => {
  assert.equal(UNIFIED_PLAYER_LOADING_TIMEOUT_MS, 20_000);
  assert.equal(UNIFIED_PLAYER_BUFFERING_TIMEOUT_MS, 30_000);
});
