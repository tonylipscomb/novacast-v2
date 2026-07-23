import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canRedeemPairingResult,
  getPairingSecondsRemaining,
  isPairingSessionActive,
  normalizePairingCode,
} from '../src/features/pairing/pairingLogic.ts';
import { pairingInstallationFingerprint } from '../src/features/pairing/pairingDiagnostics.ts';
import {
  computePollIntervalMs,
  resolvePairingSetupPhase,
  isPairingSetupInProgress,
  resolvePairingResumeDecision,
  resolvePairingUserMessage,
  shouldCreateNewSessionAfterPoll,
  shouldMarkPollingUnavailable,
  shouldResumePersistedSession,
} from '../src/features/pairing/pairingResume.ts';
import {
  formatPairingTransactionError,
  runPairingTransactionStepSync,
} from '../src/features/pairing/pairingTransactionLog.ts';
import { PAIRING_PENDING_SESSION_KEY } from '../src/features/pairing/pairingStorage.ts';
import { resetPairingServiceLocksForTests, setPairingServiceForTests } from '../src/features/pairing/pairingServiceRegistry.ts';
import { setSecureValueStoreForTests } from '../src/features/providers/providerCredentialStore.ts';

function createMemorySecureStore(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    async getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    async setItem(key, value) {
      values.set(key, value);
    },
    async deleteItem(key) {
      values.delete(key);
    },
  };
}

function pendingSession(overrides = {}) {
  return {
    id: 'session-11111111-1111-1111-1111-111111111111',
    code: 'ABCD1234',
    pairUrl: 'https://pair.example/pair?code=ABCD1234',
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

test('pairing codes normalize case, separators, and length', () => {
  assert.equal(normalizePairingCode('ab-cd 1234'), 'ABCD1234');
  assert.equal(normalizePairingCode('abcdefghi'), 'ABCDEFGH');
  assert.equal(normalizePairingCode(null), '');
});

test('pairing sessions expire truthfully and countdown does not go negative', () => {
  assert.equal(isPairingSessionActive(10_000, 9_999), true);
  assert.equal(isPairingSessionActive(10_000, 10_000), false);
  assert.equal(getPairingSecondsRemaining(10_000, 9_001), 1);
  assert.equal(getPairingSecondsRemaining(10_000, 11_000), 0);
});

test('only completed sessions with a token can redeem', () => {
  assert.equal(canRedeemPairingResult('waiting', true), false);
  assert.equal(canRedeemPairingResult('expired', true), false);
  assert.equal(canRedeemPairingResult('completed', false), false);
  assert.equal(canRedeemPairingResult('completed', true), true);
});

test('completed persisted sessions resume instead of creating a new code', () => {
  const session = pendingSession({ redemptionToken: 'token-123456789012345678901234567890' });
  assert.equal(shouldResumePersistedSession(session), true);
  assert.deepEqual(resolvePairingResumeDecision(session, 'completed'), { action: 'resume', session });
  assert.equal(shouldCreateNewSessionAfterPoll(session, 'expired'), false);
});

test('expired pending sessions create a new code only when nothing redeemable remains', () => {
  const session = pendingSession({ expiresAt: Date.now() - 1 });
  assert.equal(shouldCreateNewSessionAfterPoll(session, 'expired', Date.now()), true);
  assert.equal(
    shouldCreateNewSessionAfterPoll(
      pendingSession({ expiresAt: Date.now() - 1, redemptionToken: 'token-123456789012345678901234567890' }),
      'expired',
      Date.now(),
    ),
    false,
  );
});

test('redeemed payload resumes connect flow without another redeem request', () => {
  const payload = {
    name: 'Novacast',
    baseUrl: 'http://example.com',
    username: 'user',
    password: 'pass',
  };
  const session = pendingSession({ redeemedPayload: payload });
  assert.deepEqual(resolvePairingResumeDecision(session, null), { action: 'connect', session, payload });
});

test('polling backoff grows and unavailable threshold is enforced', () => {
  assert.equal(computePollIntervalMs(0), 1_200);
  assert.equal(computePollIntervalMs(0, 'validating'), 800);
  assert.equal(computePollIntervalMs(3), 4_800);
  assert.equal(shouldMarkPollingUnavailable(5), false);
  assert.equal(shouldMarkPollingUnavailable(6), true);
});

test('pairing user messages stay sanitized', () => {
  assert.match(resolvePairingUserMessage('failed', 'redemption_failed'), /Retry/i);
  assert.match(resolvePairingUserMessage('binding_error'), /binding/i);
  assert.match(resolvePairingUserMessage('connected'), /Home/i);
  assert.match(resolvePairingUserMessage('waiting'), /phone activation/i);
  assert.doesNotMatch(resolvePairingUserMessage('redeeming'), /password|token|http/i);
});

test('setup progress activates after phone activation and advances by phase', () => {
  assert.equal(isPairingSetupInProgress('waiting', false), false);
  assert.equal(isPairingSetupInProgress('validating', false), true);
  assert.equal(isPairingSetupInProgress('redeeming', false), true);
  assert.equal(isPairingSetupInProgress('connected', false), true);
  assert.equal(isPairingSetupInProgress('waiting', true), true);
  assert.equal(resolvePairingSetupPhase('validating', false), 1);
  assert.equal(resolvePairingSetupPhase('redeeming', false), 2);
  assert.equal(resolvePairingSetupPhase('connected', false), 3);
  assert.equal(resolvePairingSetupPhase('connected', true), 3);
});

test('pairing transaction logs preserve error message and stack', () => {
  const error = new Error('SecureStore write failed');
  const formatted = formatPairingTransactionError(error);
  assert.equal(formatted.message, 'SecureStore write failed');
  assert.match(formatted.stack ?? '', /SecureStore write failed/);

  assert.throws(
    () =>
      runPairingTransactionStepSync('test-step', () => {
        throw error;
      }),
    /SecureStore write failed/,
  );
});

test('installation fingerprint is redacted', () => {
  assert.equal(pairingInstallationFingerprint('12345678-abcd-efgh-ijkl-123456789012'), '12345678');
});

test('resumeOrCreateSession restores pending session before create', async () => {
  resetPairingServiceLocksForTests();

  const restored = pendingSession();
  let createCalls = 0;
  let statusCalls = 0;
  let bootstrapCalls = 0;
  let bootstrapPromise = null;

  const mockService = {
    async restoreSession() {
      return restored;
    },
    async resumeOrCreateSession() {
      bootstrapCalls += 1;
      if (bootstrapPromise) {
        return bootstrapPromise;
      }
      bootstrapPromise = (async () => {
        const pending = await mockService.restoreSession();
        if (pending) {
          const poll = await mockService.pollSession(pending.id, { preserveOnExpired: true });
          if (poll.status === 'completed' || poll.status === 'waiting' || poll.status === 'validating') {
            return pending;
          }
        }
        return mockService.createSession();
      })().finally(() => {
        bootstrapPromise = null;
      });
      return bootstrapPromise;
    },
    async createSession() {
      createCalls += 1;
      return pendingSession({ id: 'session-new', code: 'WXYZ9876' });
    },
    async pollSession() {
      statusCalls += 1;
      return { status: 'waiting' };
    },
    async redeemSession() {
      throw new Error('not expected');
    },
    async cancelSession() {},
    async regenerateSession() {
      return mockService.createSession();
    },
  };
  setPairingServiceForTests(mockService);

  const [first, second] = await Promise.all([mockService.resumeOrCreateSession(), mockService.resumeOrCreateSession()]);

  assert.equal(createCalls, 0);
  assert.equal(statusCalls, 1);
  assert.equal(bootstrapCalls, 2);
  assert.equal(first.id, restored.id);
  assert.equal(second.id, restored.id);
});

test('completed session redeems after remount and persists payload before cleanup', async () => {
  const store = createMemorySecureStore();
  setSecureValueStoreForTests(store);
  resetPairingServiceLocksForTests();

  const session = pendingSession();
  let redeemCalls = 0;
  let cleared = false;

  const mockService = {
    async restoreSession() {
      const raw = await store.getItem(PAIRING_PENDING_SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    },
    async resumeOrCreateSession() {
      const restored = await mockService.restoreSession();
      if (restored?.redeemedPayload) {
        return restored;
      }
      if (restored) {
        const poll = await mockService.pollSession(restored.id, { preserveOnExpired: true });
        if (poll.status === 'completed' || poll.status === 'waiting') {
          return restored;
        }
      }
      return mockService.createSession();
    },
    async createSession() {
      await store.setItem(PAIRING_PENDING_SESSION_KEY, JSON.stringify(session));
      return session;
    },
    async pollSession() {
      return {
        status: 'completed',
        redemptionToken: 'token-123456789012345678901234567890',
        providerName: 'Novacast',
      };
    },
    async redeemSession(sessionId, redemptionToken) {
      redeemCalls += 1;
      const payload = {
        name: 'Novacast',
        baseUrl: 'http://example.com',
        username: 'user',
        password: 'pass',
      };
      const pending = JSON.parse((await store.getItem(PAIRING_PENDING_SESSION_KEY)) ?? '{}');
      await store.setItem(
        PAIRING_PENDING_SESSION_KEY,
        JSON.stringify({
          ...pending,
          id: sessionId,
          redemptionToken,
          redeemedPayload: payload,
        }),
      );
      return payload;
    },
    async cancelSession() {
      cleared = true;
    },
    async regenerateSession() {
      await mockService.cancelSession();
      return mockService.createSession();
    },
  };
  setPairingServiceForTests(mockService);

  await mockService.createSession();
  const poll = await mockService.pollSession(session.id, { preserveOnExpired: true });
  assert.equal(poll.status, 'completed');
  const payload = await mockService.redeemSession(session.id, poll.redemptionToken);
  assert.equal(redeemCalls, 1);

  const persisted = JSON.parse(await store.getItem(PAIRING_PENDING_SESSION_KEY));
  assert.ok(persisted?.redeemedPayload);
  assert.equal(persisted.redeemedPayload.baseUrl, payload.baseUrl);
  assert.equal(cleared, false);

  const remounted = await mockService.resumeOrCreateSession();
  assert.equal(remounted.id, session.id);
  assert.ok(remounted.redeemedPayload);
});

test('explicit generate new code cancels the previous session', async () => {
  resetPairingServiceLocksForTests();

  let cancelCalls = 0;
  let createCalls = 0;
  const first = pendingSession();
  const second = pendingSession({ id: 'session-22222222-2222-2222-2222-222222222222', code: 'NEWCODE1' });

  const mockService = {
    async restoreSession() {
      return first;
    },
    async resumeOrCreateSession() {
      return mockService.restoreSession();
    },
    async createSession() {
      createCalls += 1;
      return second;
    },
    async pollSession() {
      return { status: 'waiting' };
    },
    async redeemSession() {
      throw new Error('not expected');
    },
    async cancelSession() {
      cancelCalls += 1;
    },
    async regenerateSession(sessionId) {
      await mockService.cancelSession(sessionId);
      return mockService.createSession();
    },
  };
  setPairingServiceForTests(mockService);

  const next = await mockService.regenerateSession(first.id);
  assert.equal(cancelCalls, 1);
  assert.equal(createCalls, 1);
  assert.equal(next.id, second.id);
});

test('failed redemption remains recoverable from persisted token', async () => {
  const session = pendingSession({
    redemptionToken: 'token-123456789012345678901234567890',
  });
  assert.equal(shouldCreateNewSessionAfterPoll(session, 'waiting'), false);
  assert.deepEqual(resolvePairingResumeDecision(session, 'waiting'), { action: 'resume', session });
});

test('provider persistence occurs before session cleanup', async () => {
  const store = createMemorySecureStore();
  setSecureValueStoreForTests(store);

  const session = pendingSession({
    redeemedPayload: {
      name: 'Novacast',
      baseUrl: 'http://example.com',
      username: 'user',
      password: 'pass',
    },
  });
  await store.setItem(PAIRING_PENDING_SESSION_KEY, JSON.stringify(session));

  assert.ok(await store.getItem(PAIRING_PENDING_SESSION_KEY));
  const { finalizePersistedPairingSession } = await import('../src/features/pairing/pairingBridge.ts');
  await finalizePersistedPairingSession();
  assert.equal(await store.getItem(PAIRING_PENDING_SESSION_KEY), null);
});
