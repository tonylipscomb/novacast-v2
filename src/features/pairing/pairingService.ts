import type { PairingConnectionPayload } from './pairingBridge.ts';
import { readPendingPairingPayload, savePendingPairingPayload } from './pairingBridge.ts';
import {
  clearPendingPairingSession,
  getPairingInstallationId,
  getPendingPairingSession,
  savePendingPairingSession,
} from './pairingDevice.ts';
import { pairingDiagnostic, pairingInstallationFingerprint } from './pairingDiagnostics.ts';
import { normalizePairingCode, PAIRING_CODE_LENGTH } from './pairingLogic.ts';
import {
  getBootstrapPromise,
  getConfiguredPairingService,
  getCreatePromise,
  setBootstrapPromise,
  setCreatePromise,
  setPairingServiceForTests,
  resetPairingServiceLocksForTests,
} from './pairingServiceRegistry.ts';
import {
  resolvePairingResumeDecision,
  shouldCreateNewSessionAfterPoll,
  type PairingPollStatus,
} from './pairingResume.ts';
import type { PairingPollResult, PairingService, PairingSession } from './pairingTypes.ts';
import { deviceAuthHeaders, registerDevice } from '@/features/device/deviceRegistration';
import { deviceFeatureFlags } from '@/features/device/deviceFeatureFlags';

export type { PairingConnectionPayload, PairingPollResult, PairingService, PairingSession } from './pairingTypes.ts';
export { setPairingServiceForTests, resetPairingServiceLocksForTests } from './pairingServiceRegistry.ts';

type PairingApiResponse = {
  errorCategory?: string;
  error?: string;
  [key: string]: unknown;
};

let remotePairingService: PairingService | null | undefined;

function getPairingApiConfig() {
  const apiUrl = process.env.EXPO_PUBLIC_NOVACAST_PAIRING_API_URL?.trim().replace(/\/+$/, '');
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!apiUrl || !anonKey) {
    return null;
  }

  return { apiUrl, anonKey };
}

function toPairingError(response: PairingApiResponse, fallback: string) {
  const category = typeof response.errorCategory === 'string' ? response.errorCategory : fallback;
  return new Error(category);
}

function normalizeSession(value: PairingApiResponse) {
  if (
    typeof value.sessionId !== 'string' ||
    typeof value.code !== 'string' ||
    typeof value.pairUrl !== 'string' ||
    typeof value.expiresAt !== 'number'
  ) {
    throw new Error('invalid_pairing_response');
  }

  const code = normalizePairingCode(value.code);
  if (code.length !== PAIRING_CODE_LENGTH) {
    throw new Error('invalid_pairing_response');
  }

  return {
    id: value.sessionId,
    code,
    pairUrl: value.pairUrl,
    expiresAt: value.expiresAt,
  } satisfies PairingSession;
}

async function persistRedemptionProgress(sessionId: string, patch: Partial<PairingSession>) {
  const pending = await getPendingPairingSession();
  if (!pending || pending.id !== sessionId) {
    return;
  }

  await savePendingPairingSession({ ...pending, ...patch });
}

function createRemotePairingService(): PairingService | null {
  const config = getPairingApiConfig();
  if (!config) {
    return null;
  }

  const { apiUrl, anonKey } = config;

  async function request(path: string, body: Record<string, unknown>) {
    let response: Response;
    try {
      response = await fetch(`${apiUrl}/${path}`, {
        method: 'POST',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          'Content-Type': 'application/json',
          ...(await deviceAuthHeaders()),
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error('pairing_service_unavailable');
    }

    let payload: PairingApiResponse = {};
    try {
      payload = (await response.json()) as PairingApiResponse;
    } catch {
      throw new Error('invalid_pairing_response');
    }

    if (!response.ok) {
      throw toPairingError(payload, 'pairing_request_failed');
    }

    return payload;
  }

  const service: PairingService = {
    async restoreSession() {
      const restored = await getPendingPairingSession();
      if (restored) {
        pairingDiagnostic('pending-session-restored', { session: restored.id.slice(0, 8) });
      }
      return restored;
    },

    async createSession() {
      if (getCreatePromise()) {
        return getCreatePromise() as Promise<PairingSession>;
      }

      const promise = (async () => {
        const installationId = await getPairingInstallationId();
        const device = await registerDevice();
        if (deviceFeatureFlags.registrationEnabled && !device.publicDeviceCode) {
          throw new Error('device_registration_failed');
        }
        pairingDiagnostic('pairing-create-requested', {
          installation: pairingInstallationFingerprint(installationId),
          device: device.publicDeviceCode ?? 'unregistered',
        });
        const payload = await request('pairing-create', {
          installationId,
          deviceId: device.deviceId,
          publicDeviceCode: device.publicDeviceCode,
        });
        const session = normalizeSession(payload);
        await savePendingPairingSession(session);
        pairingDiagnostic('pairing-session-created', {
          session: session.id.slice(0, 8),
          device: device.publicDeviceCode ?? 'unregistered',
        });
        return session;
      })();

      setCreatePromise(promise);
      try {
        return await promise;
      } finally {
        setCreatePromise(null);
      }
    },

    async resumeOrCreateSession() {
      if (getBootstrapPromise()) {
        return getBootstrapPromise() as Promise<PairingSession>;
      }

      const promise = (async () => {
        const restored = await service.restoreSession();
        if (restored?.redeemedPayload) {
          pairingDiagnostic('resume-with-redeemed-payload', { session: restored.id.slice(0, 8) });
          return restored;
        }

        if (restored) {
          try {
            const poll = await service.pollSession(restored.id, { preserveOnExpired: true });
            // pollSession may have persisted a redemption token; reload before deciding.
            const refreshed = (await getPendingPairingSession()) ?? restored;
            const decision = resolvePairingResumeDecision(refreshed, poll.status as PairingPollStatus);
            if (decision.action === 'connect') {
              return decision.session;
            }
            if (decision.action === 'resume') {
              if (poll.status === 'completed' && 'redemptionToken' in poll && poll.redemptionToken) {
                return {
                  ...refreshed,
                  redemptionToken: poll.redemptionToken,
                  providerName: poll.providerName,
                };
              }
              return refreshed;
            }
            if (shouldCreateNewSessionAfterPoll(refreshed, poll.status as PairingPollStatus)) {
              await clearPendingPairingSession();
            } else {
              return refreshed;
            }
          } catch (error) {
            const category = error instanceof Error ? error.message : 'pairing_request_failed';
            if (category === 'invalid_pairing_session') {
              await clearPendingPairingSession();
            } else {
              pairingDiagnostic('resume-poll-failed', { category });
              return restored;
            }
          }
        }

        return service.createSession();
      })();

      setBootstrapPromise(promise);
      try {
        return await promise;
      } finally {
        setBootstrapPromise(null);
      }
    },

    async pollSession(sessionId, options) {
      const installationId = await getPairingInstallationId();
      pairingDiagnostic('pairing-status-requested', {
        installation: pairingInstallationFingerprint(installationId),
        session: sessionId.slice(0, 8),
      });
      const payload = await request('pairing-status', { installationId, sessionId });
      pairingDiagnostic('pairing-status-received', {
        session: sessionId.slice(0, 8),
        status: typeof payload.status === 'string' ? payload.status : 'unknown',
      });

      if (payload.status === 'expired') {
        if (!options?.preserveOnExpired) {
          await clearPendingPairingSession();
        }
        return { status: 'expired' };
      }

      if (payload.status === 'completed' && typeof payload.redemptionToken === 'string' && typeof payload.providerName === 'string') {
        pairingDiagnostic('redeemable-state-received', { session: sessionId.slice(0, 8) });
        await persistRedemptionProgress(sessionId, {
          redemptionToken: payload.redemptionToken,
          providerName: payload.providerName,
        });
        return {
          status: 'completed',
          redemptionToken: payload.redemptionToken,
          providerName: payload.providerName,
        };
      }

      if (payload.status === 'validating') {
        return { status: 'validating' };
      }

      return { status: 'waiting' };
    },

    async redeemSession(sessionId, redemptionToken) {
      const installationId = await getPairingInstallationId();
      pairingDiagnostic('redemption-started', {
        installation: pairingInstallationFingerprint(installationId),
        session: sessionId.slice(0, 8),
      });

      let payload: PairingApiResponse;
      try {
        payload = await request('pairing-redeem', { installationId, sessionId, redemptionToken });
      } catch (error) {
        const category = error instanceof Error ? error.message : 'pairing_request_failed';
        if (category === 'redemption_already_used') {
          const pending = await getPendingPairingSession();
          if (pending?.redeemedPayload) {
            pairingDiagnostic('redemption-idempotent-local-payload', { session: sessionId.slice(0, 8) });
            return pending.redeemedPayload;
          }

          const backup = await readPendingPairingPayload();
          if (backup) {
            pairingDiagnostic('redemption-idempotent-backup-payload', { session: sessionId.slice(0, 8) });
            await persistRedemptionProgress(sessionId, { redeemedPayload: backup });
            return backup;
          }
        }

        throw error;
      }

      if (
        typeof payload.providerName !== 'string' ||
        typeof payload.baseUrl !== 'string' ||
        typeof payload.username !== 'string' ||
        typeof payload.password !== 'string'
      ) {
        throw toPairingError(payload, 'invalid_pairing_response');
      }

      const connectionPayload: PairingConnectionPayload = {
        name: payload.providerName,
        baseUrl: payload.baseUrl,
        username: payload.username,
        password: payload.password,
      };

      await savePendingPairingPayload(connectionPayload);
      await persistRedemptionProgress(sessionId, {
        redemptionToken,
        providerName: payload.providerName,
        redeemedPayload: connectionPayload,
      });
      pairingDiagnostic('redemption-succeeded', { session: sessionId.slice(0, 8) });
      return connectionPayload;
    },

    async cancelSession(sessionId) {
      const installationId = await getPairingInstallationId();
      try {
        await request('pairing-cancel', { installationId, sessionId });
      } catch {
        // Local cleanup still proceeds when the server session is already gone.
      }
      await clearPendingPairingSession();
    },

    async regenerateSession(sessionId) {
      await service.cancelSession(sessionId);
      return service.createSession();
    },
  };

  return service;
}

/** Returns the configured server service, or null when public pairing config is absent. */
export function getPairingService() {
  const configured = getConfiguredPairingService();
  if (configured) {
    return configured;
  }

  if (remotePairingService === undefined) {
    remotePairingService = createRemotePairingService();
  }

  return remotePairingService;
}
