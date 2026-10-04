import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  finalizePersistedPairingSession,
  readPendingPairingPayload,
  type PairingConnectionPayload,
} from '@/features/pairing/pairingBridge';
import {
  runPairingTransactionStep,
} from './pairingTransactionLog.ts';
import { pairingDiagnostic, logPairingEvent, logPairingReleaseDiagnostic } from './pairingDiagnostics.ts';
import { getPairingSecondsRemaining } from '@/features/pairing/pairingLogic';
import { markPairingCompleted, resetPairingCompleted } from '@/features/pairing/pairingState';
import {
  computePollIntervalMs,
  resolvePairingUserMessage,
  shouldMarkPollingUnavailable,
} from '@/features/pairing/pairingResume';
import { getPairingService } from './pairingService';
import type { PairingSession } from './pairingTypes';

type PairingStatus =
  | 'initializing'
  | 'waiting'
  | 'validating'
  | 'redeeming'
  | 'connected'
  | 'expired'
  | 'failed'
  | 'unavailable'
  | 'binding_error';

export function usePairing() {
  const service = getPairingService();
  const [status, setStatus] = useState<PairingStatus>(() => (service ? 'initializing' : 'unavailable'));
  const [session, setSession] = useState<PairingSession | null>(null);
  const [connectionPayload, setConnectionPayload] = useState<PairingConnectionPayload | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [failureCategory, setFailureCategory] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(Boolean(service));

  const redeemingRef = useRef(false);
  const pollingRef = useRef(false);
  const regeneratingRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollFailuresRef = useRef(0);
  const mountedRef = useRef(true);
  const sessionRef = useRef<PairingSession | null>(null);
  const pollOnceRef = useRef<((expectedGeneration?: number) => Promise<void>) | null>(null);
  const sessionGenerationRef = useRef(0);
  const pollingGenerationRef = useRef<number | null>(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sessionGenerationRef.current += 1;
      pollingRef.current = false;
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

  const installSession = useCallback((nextSession: PairingSession, reason: string) => {
    const sessionGeneration = sessionGenerationRef.current + 1;
    sessionGenerationRef.current = sessionGeneration;
    sessionRef.current = nextSession;
    setSession(nextSession);
    setSecondsRemaining(getPairingSecondsRemaining(nextSession.expiresAt));
    logPairingReleaseDiagnostic('session-installed', {
      sessionGeneration,
      expiresInMs: Math.max(0, nextSession.expiresAt - Date.now()),
      reason,
    });
    return sessionGeneration;
  }, []);

  const invalidateSession = useCallback((reason: string) => {
    const sessionGeneration = sessionGenerationRef.current + 1;
    sessionGenerationRef.current = sessionGeneration;
    sessionRef.current = null;
    pollingRef.current = false;
    pollingGenerationRef.current = null;
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setSession(null);
    setSecondsRemaining(0);
    logPairingReleaseDiagnostic('session-invalidated', { sessionGeneration, reason });
    return sessionGeneration;
  }, []);

  const schedulePoll = useCallback((delayMs: number, expectedGeneration = sessionGenerationRef.current) => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
    }

    pollTimerRef.current = setTimeout(() => {
      pollTimerRef.current = null;
      if (expectedGeneration !== sessionGenerationRef.current || !sessionRef.current) {
        logPairingReleaseDiagnostic('stale-timer-ignored', {
          sessionGeneration: expectedGeneration,
          reason: 'session-generation-mismatch',
        });
        return;
      }
      void pollOnceRef.current?.(expectedGeneration);
    }, delayMs);
  }, []);

  const redeemSession = useCallback(
    async (activeSession: PairingSession, redemptionToken: string, expectedGeneration = sessionGenerationRef.current) => {
      if (!service || redeemingRef.current || expectedGeneration !== sessionGenerationRef.current) {
        return;
      }

      redeemingRef.current = true;
      setStatus('redeeming');
      setFailureCategory(null);

      try {
        const payload = await service.redeemSession(activeSession.id, redemptionToken);
        if (!mountedRef.current) {
          return;
        }

        if (expectedGeneration !== sessionGenerationRef.current || sessionRef.current?.id !== activeSession.id) {
          logPairingReleaseDiagnostic('stale-status-ignored', {
            sessionGeneration: expectedGeneration,
            reason: 'redemption-generation-mismatch',
          });
          return;
        }

        setConnectionPayload(payload);
        setStatus('connected');
        markPairingCompleted();
      } catch (error) {
        if (!mountedRef.current) {
          return;
        }

        const category = error instanceof Error ? error.message : 'redemption_failed';
        setFailureCategory(category === 'invalid_pairing_session' ? 'binding_error' : 'redemption_failed');
        setStatus(category === 'invalid_pairing_session' ? 'binding_error' : 'failed');
      } finally {
        redeemingRef.current = false;
      }
    },
    [service],
  );

  const pollOnce = useCallback(async (expectedGeneration = sessionGenerationRef.current) => {
    const activeSession = sessionRef.current;
    if (
      !service ||
      !activeSession ||
      expectedGeneration !== sessionGenerationRef.current ||
      pollingRef.current ||
      redeemingRef.current
    ) {
      return;
    }

    if (activeSession.redeemedPayload) {
      setConnectionPayload(activeSession.redeemedPayload);
      setStatus('connected');
      markPairingCompleted();
      return;
    }

    pollingRef.current = true;
    pollingGenerationRef.current = expectedGeneration;
    logPairingReleaseDiagnostic('poll-started', {
      sessionGeneration: expectedGeneration,
      reason: 'request',
    });
    try {
      const result = await service.pollSession(activeSession.id, { preserveOnExpired: true });
      if (!mountedRef.current) {
        return;
      }

      if (expectedGeneration !== sessionGenerationRef.current || sessionRef.current?.id !== activeSession.id) {
        logPairingReleaseDiagnostic('stale-status-ignored', {
          sessionGeneration: expectedGeneration,
          reason: 'session-generation-mismatch',
        });
        return;
      }

      pollFailuresRef.current = 0;

      logPairingEvent('poll_result', { status: result.status, session: activeSession.id.slice(0, 8) });

      if (result.status === 'expired') {
        setStatus('expired');
        logPairingReleaseDiagnostic('countdown-expired', {
          sessionGeneration: expectedGeneration,
          state: 'expired',
          remainingMs: 0,
          reason: 'server-status',
        });
        return;
      }

      if (result.status === 'validating') {
        setStatus('validating');
        schedulePoll(computePollIntervalMs(0, 'validating'), expectedGeneration);
        return;
      }

      if (result.status === 'completed') {
        logPairingEvent('activation_received', { session: activeSession.id.slice(0, 8) });
        await redeemSession(activeSession, result.redemptionToken, expectedGeneration);
        return;
      }

      setStatus('waiting');
      schedulePoll(computePollIntervalMs(0, 'waiting'), expectedGeneration);
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }

      if (expectedGeneration !== sessionGenerationRef.current || sessionRef.current?.id !== activeSession.id) {
        logPairingReleaseDiagnostic('stale-status-ignored', {
          sessionGeneration: expectedGeneration,
          reason: 'poll-error-generation-mismatch',
        });
        return;
      }

      pollFailuresRef.current += 1;
      const category = error instanceof Error ? error.message : 'pairing_request_failed';
      logPairingEvent('poll_failed', { category, failures: pollFailuresRef.current });
      if (category === 'invalid_pairing_session') {
        setFailureCategory('binding_error');
        setStatus('binding_error');
        return;
      }

      // Surface hard server failures instead of looking like endless "waiting".
      if (
        category === 'server_configuration_error' ||
        category === 'unexpected_server_error' ||
        category === 'activation_required'
      ) {
        setFailureCategory(category);
        setStatus('unavailable');
        return;
      }

      if (shouldMarkPollingUnavailable(pollFailuresRef.current)) {
        setFailureCategory(category || 'pairing_service_unavailable');
        setStatus('unavailable');
        return;
      }

      setFailureCategory(category);
      setStatus(sessionRef.current?.redemptionToken ? 'redeeming' : 'waiting');
      schedulePoll(computePollIntervalMs(pollFailuresRef.current), expectedGeneration);
    } finally {
      if (pollingGenerationRef.current === expectedGeneration) {
        pollingRef.current = false;
        pollingGenerationRef.current = null;
        logPairingReleaseDiagnostic('poll-stopped', {
          sessionGeneration: expectedGeneration,
          reason: 'request-complete',
        });
      }
    }
  }, [redeemSession, schedulePoll, service]);

  useEffect(() => {
    pollOnceRef.current = pollOnce;
  }, [pollOnce]);

  useEffect(() => {
    if (status !== 'validating' || pollingRef.current || redeemingRef.current || !sessionRef.current) {
      return;
    }

    void pollOnce();
  }, [pollOnce, status]);

  useEffect(() => {
    if (!service) {
      return;
    }

    let cancelled = false;

    const bootstrap = async () => {
      setInitializing(true);
      setStatus('initializing');
      setFailureCategory(null);

      try {
        const nextSession = await service.resumeOrCreateSession();
        if (cancelled || !mountedRef.current) {
          return;
        }

        const sessionGeneration = installSession(nextSession, 'bootstrap');
        if (nextSession.redeemedPayload) {
          pairingDiagnostic('provider-persistence-resume', { session: nextSession.id.slice(0, 8) });
          setConnectionPayload(nextSession.redeemedPayload);
          setStatus('connected');
          markPairingCompleted();
          return;
        }

        if (nextSession.redemptionToken) {
          setStatus('redeeming');
          await redeemSession(nextSession, nextSession.redemptionToken, sessionGeneration);
          return;
        }

        setStatus('waiting');
        pairingDiagnostic('polling-started', { session: nextSession.id.slice(0, 8) });
        void pollOnce(sessionGeneration);
      } catch (error) {
        if (!cancelled && mountedRef.current) {
          const category = error instanceof Error ? error.message : 'pairing_service_unavailable';
          setStatus('unavailable');
          setFailureCategory(category || 'pairing_service_unavailable');
        }
      } finally {
        if (!cancelled && mountedRef.current) {
          setInitializing(false);
        }
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [installSession, pollOnce, redeemSession, service]);

  useEffect(() => {
    if (!session) {
      return;
    }

    const sessionGeneration = sessionGenerationRef.current;
    const update = () => {
      if (sessionGeneration !== sessionGenerationRef.current || sessionRef.current?.id !== session.id) {
        logPairingReleaseDiagnostic('stale-timer-ignored', {
          sessionGeneration,
          reason: 'countdown-generation-mismatch',
        });
        return;
      }
      setSecondsRemaining(getPairingSecondsRemaining(session.expiresAt));
    };
    logPairingReleaseDiagnostic('countdown-started', {
      sessionGeneration,
      expiresInMs: Math.max(0, session.expiresAt - Date.now()),
      reason: 'session-installed',
    });
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [session]);

  // Mark expired from the session timestamp only — never from a stale countdown left
  // over from the previous code (that caused an infinite regenerate loop).
  useEffect(() => {
    if (status !== 'waiting' || !session || regeneratingRef.current || secondsRemaining > 0) {
      return;
    }

    setStatus('expired');
    setFailureCategory(null);
    logPairingReleaseDiagnostic('countdown-expired', {
      sessionGeneration: sessionGenerationRef.current,
      state: 'expired',
      remainingMs: 0,
      reason: 'local-countdown',
    });
  }, [secondsRemaining, session, status]);

  const retrySession = useCallback(async () => {
    if (!service) {
      return;
    }

    setFailureCategory(null);
    const restored = (await service.restoreSession()) ?? sessionRef.current;
    if (!restored) {
      setStatus('unavailable');
      return;
    }

    const sessionGeneration = installSession(restored, 'resume');

    if (restored.redeemedPayload) {
      const backup = restored.redeemedPayload ?? (await readPendingPairingPayload());
      if (backup) {
        setConnectionPayload(backup);
        setStatus('connected');
        markPairingCompleted();
        return;
      }
    }

    if (restored.redemptionToken) {
      await redeemSession(restored, restored.redemptionToken, sessionGeneration);
      return;
    }

    pollFailuresRef.current = 0;
    setStatus('waiting');
    void pollOnce(sessionGeneration);
  }, [installSession, pollOnce, redeemSession, service]);

  const regenerateCode = useCallback(async () => {
    if (!service || regeneratingRef.current) {
      return;
    }

    regeneratingRef.current = true;
    resetPairingCompleted();
    redeemingRef.current = false;
    pollFailuresRef.current = 0;
    setConnectionPayload(null);
    setFailureCategory(null);

    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    try {
      const activeSession = sessionRef.current;
      const refreshStartedAt = Date.now();
      invalidateSession('refresh-started');
      setStatus('initializing');
      const nextSession = activeSession
        ? await service.regenerateSession(activeSession.id)
        : await service.createSession();
      if (!mountedRef.current) {
        return;
      }

      const sessionGeneration = installSession(nextSession, 'refresh-created');
      setStatus('waiting');
      logPairingReleaseDiagnostic('refresh-created', {
        sessionGeneration,
        expiresInMs: Math.max(0, nextSession.expiresAt - Date.now()),
        elapsedMs: Date.now() - refreshStartedAt,
        reason: 'new-session',
      });
      pairingDiagnostic('polling-started', { session: nextSession.id.slice(0, 8) });
      void pollOnce(sessionGeneration);
    } catch (error) {
      if (mountedRef.current) {
        const category = error instanceof Error ? error.message : 'pairing_service_unavailable';
        setStatus('unavailable');
        setFailureCategory(category || 'pairing_service_unavailable');
      }
    } finally {
      regeneratingRef.current = false;
    }
  }, [installSession, invalidateSession, pollOnce, service]);

  const countdownLabel = useMemo(() => {
    const minutes = Math.floor(secondsRemaining / 60).toString().padStart(2, '0');
    const seconds = (secondsRemaining % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
  }, [secondsRemaining]);

  const statusText = resolvePairingUserMessage(status, failureCategory);

  return {
    code: session?.code ?? null,
    shortUrl: session?.pairUrl ?? null,
    status,
    statusText,
    countdownLabel,
    secondsRemaining,
    regenerateCode,
    retrySession,
    isAvailable: Boolean(service),
    connectionPayload,
    failureCategory,
    isInitializing: initializing,
  };
}

export async function completePersistedPairing(connectionPayload: PairingConnectionPayload) {
  return runPairingTransactionStep(
    'completePersistedPairing',
    async () => {
      await runPairingTransactionStep(
        'completePersistedPairing.connectXtreamProvider',
        async () => {
          const { connectXtreamProvider } = await import('@/features/providers/providerStore');
          await connectXtreamProvider(connectionPayload);
        },
        { providerName: connectionPayload.name },
      );
      await runPairingTransactionStep('completePersistedPairing.finalizePersistedPairingSession', () =>
        finalizePersistedPairingSession(),
      );
      await runPairingTransactionStep('completePersistedPairing.markPairingCompleted', async () => {
        markPairingCompleted();
      });
    },
    { providerName: connectionPayload.name },
  );
}

export const useMockPairing = usePairing;
