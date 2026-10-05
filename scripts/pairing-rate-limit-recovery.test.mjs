import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { computePollIntervalMs, computeRateLimitBackoffMs } from '../src/features/pairing/pairingResume.ts';

const hook = readFileSync('src/features/pairing/useMockPairing.ts', 'utf8');
const service = readFileSync('src/features/pairing/pairingService.ts', 'utf8');
const diagnostics = readFileSync('src/features/pairing/pairingDiagnostics.ts', 'utf8');
const screen = readFileSync('src/features/pairing/PairingScreen.tsx', 'utf8');

test('normal pairing-status cadence is five seconds for waiting and validating', () => {
  assert.equal(computePollIntervalMs(0, 'waiting'), 5_000);
  assert.equal(computePollIntervalMs(0, 'validating'), 5_000);
});

test('429 backoff is bounded at 10, 15, and 30 seconds', () => {
  assert.deepEqual([1, 2, 3, 4].map(computeRateLimitBackoffMs), [10_000, 15_000, 30_000, 30_000]);
});

test('pairing status preserves 429 status metadata and treats rate_limited as transient', () => {
  assert.match(service, /toPairingError\(payload, 'pairing_request_failed', response\.status\)/);
  assert.match(hook, /statusCode === 429 \|\| category === 'rate_limited'/);
  assert.match(hook, /schedulePoll\(pollDelayMs, expectedGeneration, backoffStep\)/);
  assert.match(hook, /poll-backoff-scheduled/);
  assert.doesNotMatch(hook, /isRateLimited[\s\S]{0,500}setStatus\('unavailable'\)/);
});

test('429 keeps the current session generation and does not create a new code', () => {
  assert.match(hook, /rateLimitBackoffStepRef/);
  assert.match(hook, /expectedGeneration, backoffStep/);
  assert.doesNotMatch(hook, /isRateLimited[\s\S]{0,700}invalidateSession/);
  assert.doesNotMatch(hook, /isRateLimited[\s\S]{0,700}regenerateCode/);
});

test('successful status resets rate-limit backoff before handling the response', () => {
  assert.match(hook, /poll-backoff-reset/);
  assert.match(hook, /rateLimitBackoffStepRef\.current = 0/);
  assert.match(hook, /poll-complete/);
});

test('scheduled polling is bounded by local expiresAt and generation identity', () => {
  assert.match(hook, /Math\.min\(delayMs, remainingMs\)/);
  assert.match(hook, /Date\.now\(\) >= sessionRef\.current\.expiresAt/);
  assert.match(hook, /sessionRef\.current\.id !== scheduledSessionId/);
  assert.match(hook, /poll-scheduled/);
});

test('completed status stops polling and redeems once per generation', () => {
  assert.match(hook, /completed-observed/);
  assert.match(hook, /await redeemSession\(activeSession, result\.redemptionToken, expectedGeneration\)/);
  assert.match(hook, /redeemingRef\.current/);
  assert.match(hook, /redeem-skipped-duplicate/);
  assert.match(hook, /redeem-started/);
  assert.match(hook, /redeem-complete/);
});

test('stale completed/redeem responses cannot affect a refreshed session', () => {
  assert.match(hook, /reason: 'session-generation-mismatch'/);
  assert.match(hook, /reason: 'redeem-generation-mismatch'/);
  assert.match(hook, /reason: 'redeem-error-generation-mismatch'/);
  assert.match(hook, /expectedGeneration !== sessionGenerationRef\.current \|\| sessionRef\.current\?\.id !== activeSession\.id/);
});

test('transient redeem failures retry a bounded number of times without concurrent redeems', () => {
  assert.match(hook, /redeemAttemptsRef/);
  assert.match(hook, /transientFailure/);
  assert.match(hook, /redeemAttemptsRef\.current < 3/);
  assert.match(hook, /redeem-retry-scheduled/);
  assert.match(hook, /if \(redeemingRef\.current\)/);
});

test('existing provider installation and screen continuation remain in the established path', () => {
  assert.match(screen, /provider-install-started/);
  assert.match(screen, /completePersistedPairing\(payload\)/);
  assert.match(screen, /provider-install-complete/);
  assert.match(screen, /pairing-screen-exit/);
  assert.match(screen, /prepareChannelsThenHome\(\)/);
});

test('pairing diagnostics add only bounded metadata and no sensitive fields', () => {
  assert.match(diagnostics, /pollDelayMs\?: number/);
  assert.match(diagnostics, /backoffStep\?: number/);
  assert.doesNotMatch(diagnostics, /pairingCode|pairUrl|username|password|redemptionToken|deviceSecret|authToken|providerUrl/i);
  assert.doesNotMatch(hook, /logPairingReleaseDiagnostic\([^\n]*(?:sessionId|pairingCode|redemptionToken|providerUrl)/i);
});
